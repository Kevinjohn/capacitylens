// View-as-member uses the pinned `@kevinjohn/adonisjs-masquerade` package for identity-wide,
// read-only modes and durable lifecycle audit.
//
// Package admission captures the request identity before product transactions. Package operations
// never run inside the single-connection product transaction.
//
// Package events are authoritative for view-as lifecycle audit. They carry no company ID and no
// separate explicit, company-switch or sign-out classification.

import type { HttpContext } from '@adonisjs/core/http';
import { MasqueradeError as PackageMasqueradeError } from '@kevinjohn/adonisjs-masquerade';
import type { MasqueradeService, ModeView } from '@kevinjohn/adonisjs-masquerade';
import app from '@adonisjs/core/services/app';
import { nativeAdapter } from '#config/masquerade';
import { actorIn } from '#services/auth/current_actor';
import type {
  QueryClientContract,
  TransactionClientContract,
} from '@adonisjs/lucid/types/database';
import {
  listActiveCompanyIds,
  activeCompanyRole,
  IdentityAuthorityError,
} from '#services/auth/authorization';
import access from '#config/access_control';
import type { Role } from '@capacitylens/shared/account/types';
import { accessGrant } from '#services/auth/access_grant';

export { PackageMasqueradeError as MasqueradeError };

/** The Masquerade service the package's provider builds and owns. */
export async function masqueradeService(): Promise<MasqueradeService<HttpContext>> {
  const runtime = await app.container.make('masquerade.runtime');
  return runtime.service;
}

/**
 * Current package mode with product display details, read outside any product transaction. The
 * package reads its own state from the request; the caller supplies the company it asked about.
 */
export async function currentMasquerade(
  ctx: HttpContext,
  client: QueryClientContract,
  requestedAccountId: string | undefined
) {
  const service = await masqueradeService();
  try {
    await service.resolve(ctx);
  } catch (error) {
    if (
      !(error instanceof PackageMasqueradeError) ||
      error.code !== 'E_MASQUERADE_CONTEXT_CHANGED'
    ) {
      throw error;
    }
  }
  const view = await service.status(ctx);
  if (!view.isMasquerading) return { active: false as const, contextToken: view.contextToken };
  const actor = await nativeAdapter.authenticateActor(ctx);
  const target = await client
    .from('users')
    .where('id', view.targetId)
    .select('display_name', 'email')
    .first();
  if (!target) throw new PackageMasqueradeError('E_MASQUERADE_CONTEXT_CHANGED');
  let accountId: string | null = null;
  let effectiveRole: Role | null = null;
  if (requestedAccountId) {
    const actorRole = await activeCompanyRole(actor.id, requestedAccountId, undefined);
    const targetRole = await activeCompanyRole(view.targetId, requestedAccountId, undefined);
    if (actorRole && access.can(actorRole, 'viewAs:use') && targetRole) {
      accountId = requestedAccountId;
      effectiveRole = targetRole;
    }
  }
  // Another tab of the same sign-in may sit on a company the target does not share. Report the
  // mode where it holds so that tab can adopt the current context and offer End; company reads
  // are still authorized per request by effectiveReadPrincipal.
  if (!accountId) {
    const memberships = await listActiveCompanyIds(actor.id, undefined);
    for (const candidate of memberships) {
      const actorRole = await activeCompanyRole(actor.id, candidate, undefined);
      const targetRole = await activeCompanyRole(view.targetId, candidate, undefined);
      if (actorRole && access.can(actorRole, 'viewAs:use') && targetRole) {
        accountId = candidate;
        effectiveRole = targetRole;
        break;
      }
    }
    if (!accountId || !effectiveRole) {
      throw new PackageMasqueradeError('E_MASQUERADE_CONTEXT_CHANGED');
    }
  }
  // An empty display name falls through to the email, so these are string-or-empty, not nullable.
  const displayName = String(target.display_name ?? '');
  const email = String(target.email ?? '');
  if (!effectiveRole) throw new PackageMasqueradeError('E_MASQUERADE_CONTEXT_CHANGED');
  return {
    active: true as const,
    accountId,
    targetUserId: view.targetId,
    targetName: displayName || email || 'Member',
    effectiveRole,
    startedAt: view.startedAt,
    expiresAt: view.expiresAt,
    contextToken: view.contextToken,
    token: view.contextToken,
    principal: { id: actor.id, name: actor.user.displayName, email: actor.user.email },
    ...accessGrant(effectiveRole, true),
  };
}

/** Starts a read-only view as the target; `expectedContext` is the caller's current context token. */
export async function startMasquerade(
  ctx: HttpContext,
  targetUserId: string,
  expectedContext: string
) {
  const service = await masqueradeService();
  return service.start(ctx, { targetId: targetUserId, access: 'view', expectedContext });
}

/** Ends the view; `expectedContext` is the caller's current context token. */
export async function endMasquerade(ctx: HttpContext, expectedContext: string) {
  const service = await masqueradeService();
  return service.stop(ctx, { expectedContext });
}

/** Resolves only the identity admitted before the product transaction; never substitutes on error. */
export async function effectiveReadPrincipal(
  trx: TransactionClientContract,
  accountId: string | undefined
) {
  const actor = actorIn(trx);
  const context = actor.masqueradeContext;
  if (!context || context.actorId !== actor.userId) {
    throw new PackageMasqueradeError('E_MASQUERADE_CONTEXT_CHANGED');
  }
  if (context.isMasquerading && accountId) {
    const actorRole = await activeCompanyRole(actor.userId, accountId, trx);
    const targetRole = await activeCompanyRole(context.effectiveId, accountId, trx);
    if (!actorRole || !access.can(actorRole, 'viewAs:use') || !targetRole) {
      throw new IdentityAuthorityError('Masquerade company authority changed.');
    }
  }
  return {
    actorId: actor.userId,
    effectiveId: context.effectiveId,
    accountId: context.isMasquerading ? (accountId ?? null) : null,
    isMasquerading: context.isMasquerading,
  };
}

export type { ModeView };
