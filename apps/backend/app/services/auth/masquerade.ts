import type { HttpContext } from '@adonisjs/core/http';
import { MasqueradeError as PackageMasqueradeError } from '@kevinjohn/adonisjs-masquerade';
import type { MasqueradeService, ModeView } from '@kevinjohn/adonisjs-masquerade';
import app from '@adonisjs/core/services/app';
import db from '@adonisjs/lucid/services/db';
import { nativeAdapter } from '#config/masquerade';
import { actorIn } from '#services/auth/current_actor';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import {
  listActiveCompanyIds,
  activeCompanyRole,
  IdentityAuthorityError,
} from '#services/auth/authorization';
import access from '#config/access_control';
import type { Role } from '@capacitylens/shared/account/types';

export { PackageMasqueradeError as MasqueradeError };

/** The Masquerade service the package's provider builds and owns. */
export async function masqueradeService(): Promise<MasqueradeService<HttpContext>> {
  const runtime = await app.container.make('masquerade.runtime');
  return runtime.service;
}

/** Current package mode with product display details, read outside any product transaction. */
export async function currentMasquerade(ctx: HttpContext) {
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
  const target = await db
    .from('users')
    .where('id', view.targetId)
    .select('display_name', 'email')
    .first();
  if (!target) throw new PackageMasqueradeError('E_MASQUERADE_CONTEXT_CHANGED');
  const requestedAccountId =
    (typeof ctx.params.accountId === 'string' && ctx.params.accountId) ||
    (typeof ctx.request.input('accountId') === 'string' && ctx.request.input('accountId'));
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
  };
}

export async function startMasquerade(ctx: HttpContext, targetUserId: string) {
  const service = await masqueradeService();
  return service.start(ctx, {
    targetId: targetUserId,
    access: 'view',
    expectedContext: ctx.request.header('X-Masquerade-Context') ?? '',
  });
}

export async function endMasquerade(ctx: HttpContext) {
  const service = await masqueradeService();
  return service.stop(ctx, {
    expectedContext: ctx.request.header('X-Masquerade-Context') ?? '',
  });
}

/** Resolves only the identity admitted before the product transaction; never substitutes on error. */
export async function effectiveReadPrincipal(
  ctx: HttpContext,
  trx: TransactionClientContract,
  requestedAccountId?: string
) {
  const actor = actorIn(trx);
  const context = actor.masqueradeContext;
  if (!context || context.actorId !== actor.userId) {
    throw new PackageMasqueradeError('E_MASQUERADE_CONTEXT_CHANGED');
  }
  const accountId =
    requestedAccountId ??
    (typeof ctx.params.accountId === 'string' ? ctx.params.accountId : undefined);
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
