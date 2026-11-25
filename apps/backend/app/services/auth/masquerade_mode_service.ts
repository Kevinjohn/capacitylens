import { inject } from '@adonisjs/core';
// View-as-member uses the pinned `@kevinjohn/adonisjs-masquerade` package for identity-wide,
// read-only modes and durable lifecycle audit.
//
// Package admission captures the request identity before product transactions. Package operations
// never run inside the single-connection product transaction.
//
// Package events are authoritative for view-as lifecycle audit. They carry no company ID and no
// separate explicit, company-switch or sign-out classification.

import type { HttpContext } from '@adonisjs/core/http';
import { errors as masqueradeErrors } from '@kevinjohn/adonisjs-masquerade';
import type { MasqueradeService, ModeView } from '@kevinjohn/adonisjs-masquerade';
import app from '@adonisjs/core/services/app';
import { nativeAdapter } from '#services/auth/masquerade_authority_service';
import { CurrentActorService } from '#services/auth/current_actor_service';
import type {
  QueryClientContract,
  TransactionClientContract,
} from '@adonisjs/lucid/types/database';
import { AuthorizationService } from '#services/auth/authorization_service';
import IdentityAuthorizationException from '#exceptions/identity_authorization_exception';
import { canMasqueradeAs } from '@capacitylens/shared/domain/access';
import type { Role } from '@capacitylens/shared/account/types';
import { AccessGrantService } from '#services/auth/access_grant_service';

export type { ModeView };

/** The view-as mode: its current state, start and end, and the identity a read uses. */
@inject()
export class MasqueradeModeService {
  #currentActor: CurrentActorService;
  #authorization: AuthorizationService;
  #accessGrant: AccessGrantService;

  constructor(
    currentActor: CurrentActorService,
    authorization: AuthorizationService,
    accessGrant: AccessGrantService
  ) {
    this.#currentActor = currentActor;
    this.#authorization = authorization;
    this.#accessGrant = accessGrant;
  }

  /** The Masquerade service the package's provider builds and owns. */
  async getMasqueradeService(): Promise<MasqueradeService<HttpContext>> {
    const runtime = await app.container.make('masquerade.runtime');
    return runtime.service;
  }

  /**
   * Current package mode with product display details, read outside any product transaction. The
   * package reads its own state from the request; the caller supplies the company it asked about.
   */
  async readCurrentMasquerade(
    ctx: HttpContext,
    client: QueryClientContract,
    requestedCompanyId: string | undefined
  ) {
    const service = await this.getMasqueradeService();
    try {
      await service.resolve(ctx);
    } catch (error) {
      if (!(error instanceof masqueradeErrors.E_MASQUERADE_CONTEXT_CHANGED)) {
        throw error;
      }
    }
    const view = await service.status(ctx);
    if (!view.isMasquerading) return { active: false as const, masqueradeToken: view.contextToken };
    const actor = await nativeAdapter.authenticateActor(ctx);
    const target = await client
      .from('users')
      .where('id', view.targetId)
      .select('display_name', 'email')
      .first();
    if (!target) throw new masqueradeErrors.E_MASQUERADE_CONTEXT_CHANGED();
    let companyId: string | null = null;
    let effectiveRole: Role | null = null;
    if (requestedCompanyId) {
      const actorRole = await this.#authorization.getActiveCompanyRole(
        actor.id,
        requestedCompanyId,
        undefined
      );
      const targetRole = await this.#authorization.getActiveCompanyRole(
        view.targetId,
        requestedCompanyId,
        undefined
      );
      if (actorRole && targetRole && canMasqueradeAs(actorRole, targetRole)) {
        companyId = requestedCompanyId;
        effectiveRole = targetRole;
      }
    }
    // Another tab of the same sign-in may sit on a company the target does not share. Report the
    // mode where it holds so that tab can adopt the current context and offer End; company reads
    // are still authorized per request by resolveEffectiveReadUser.
    if (!companyId) {
      const memberships = await this.#authorization.listActiveCompanyIds(actor.id, undefined);
      for (const candidate of memberships) {
        const actorRole = await this.#authorization.getActiveCompanyRole(
          actor.id,
          candidate,
          undefined
        );
        const targetRole = await this.#authorization.getActiveCompanyRole(
          view.targetId,
          candidate,
          undefined
        );
        if (actorRole && targetRole && canMasqueradeAs(actorRole, targetRole)) {
          companyId = candidate;
          effectiveRole = targetRole;
          break;
        }
      }
      if (!companyId) throw new masqueradeErrors.E_MASQUERADE_CONTEXT_CHANGED();
    }
    // An empty display name falls through to the email, so these are string-or-empty, not nullable.
    const displayName = String(target.display_name ?? '');
    const email = String(target.email ?? '');
    if (!effectiveRole) throw new masqueradeErrors.E_MASQUERADE_CONTEXT_CHANGED();
    return {
      active: true as const,
      companyId,
      targetUserId: view.targetId,
      targetName: displayName || email || 'Member',
      effectiveRole,
      startedAt: view.startedAt,
      expiresAt: view.expiresAt,
      masqueradeToken: view.contextToken,
      token: view.contextToken,
      actor: { id: actor.id, name: actor.user.displayName, email: actor.user.email },
      ...this.#accessGrant.buildAccessGrant(effectiveRole, true),
    };
  }

  /** Starts a read-only view as the target; `expectedContext` is the caller's current context token. */
  async startMasquerade(ctx: HttpContext, targetUserId: string, expectedContext: string) {
    const service = await this.getMasqueradeService();
    return service.start(ctx, { targetId: targetUserId, access: 'view', expectedContext });
  }

  /** Ends the view; `expectedContext` is the caller's current context token. */
  async endMasquerade(ctx: HttpContext, expectedContext: string) {
    const service = await this.getMasqueradeService();
    return service.stop(ctx, { expectedContext });
  }

  /**
   * Resolves only the identity admitted before the product transaction; never substitutes on error.
   * A view whose company access changed is refused with `refuse`: planning passes its
   * `ACCOUNT_MEMBERSHIP_LOST`, which tells the browser to drop its planning projection.
   */
  async resolveEffectiveReadUser(
    trx: TransactionClientContract,
    companyId: string | undefined,
    refuse: () => Error = () =>
      new IdentityAuthorizationException('Masquerade company access changed.')
  ) {
    const actor = this.#currentActor.requireActor(trx);
    const context = actor.masqueradeContext;
    if (!context || context.actorId !== actor.userId) {
      throw new masqueradeErrors.E_MASQUERADE_CONTEXT_CHANGED();
    }
    if (context.isMasquerading) {
      // Without a company there is no rank to check, so a view never reads company-free.
      if (!companyId) throw refuse();
      const actorRole = await this.#authorization.getActiveCompanyRole(
        actor.userId,
        companyId,
        trx
      );
      const targetRole = await this.#authorization.getActiveCompanyRole(
        context.effectiveId,
        companyId,
        trx
      );
      if (!actorRole || !targetRole || !canMasqueradeAs(actorRole, targetRole)) {
        throw refuse();
      }
    }
    return {
      actorId: actor.userId,
      effectiveId: context.effectiveId,
      companyId: context.isMasquerading ? (companyId ?? null) : null,
      isMasquerading: context.isMasquerading,
    };
  }
}
