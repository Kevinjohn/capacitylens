// Request-scoped masquerade control runs outside the single-connection product transaction.
// Package events are authoritative for masquerade lifecycle audit.

import { inject } from '@adonisjs/core'
import { HttpContext } from '@adonisjs/core/http'
import app from '@adonisjs/core/services/app'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { errors as masqueradeErrors } from '@kevinjohn/adonisjs-masquerade'
import type { MasqueradeService } from '@kevinjohn/adonisjs-masquerade'
import { canMasqueradeAs } from '@capacitylens/shared/domain/access'
import type { Role } from '@capacitylens/shared/account/types'
import User from '#models/user'
import { AccessGrantService } from '#services/auth/access_grant_service'
import { AuthorizationService } from '#services/auth/authorization_service'
import { nativeAdapter } from '#services/auth/masquerade_authority_service'

/** Request-scoped control for starting, reading and ending the actor's masquerade mode. */
@inject()
export class MasqueradeControlService {
  #ctx: HttpContext
  #authorization: AuthorizationService
  #accessGrant: AccessGrantService

  constructor(
    ctx: HttpContext,
    authorization: AuthorizationService,
    accessGrant: AccessGrantService
  ) {
    this.#ctx = ctx
    this.#authorization = authorization
    this.#accessGrant = accessGrant
  }

  async #getMasqueradeService(): Promise<MasqueradeService<HttpContext>> {
    const runtime = await app.container.make('masquerade.runtime')
    return runtime.service
  }

  /**
   * Current package mode with product display details, read outside any product transaction. The
   * package reads its own state from the request; the caller supplies the company it asked about.
   */
  async readCurrentMasquerade(client: QueryClientContract, requestedCompanyId: string | undefined) {
    const service = await this.#getMasqueradeService()
    try {
      await service.resolve(this.#ctx)
    } catch (error) {
      // A stale request token still lets status() report the live mode so the caller can recover.
      if (!(error instanceof masqueradeErrors.E_MASQUERADE_CONTEXT_CHANGED)) {
        throw error
      }
    }
    const view = await service.status(this.#ctx)
    if (!view.isMasquerading) return { active: false as const, masqueradeToken: view.contextToken }
    const actor = await nativeAdapter.authenticateActor(this.#ctx)
    const target = await User.query({ client })
      .where('id', view.targetId)
      .select('display_name', 'email')
      .first()
    if (!target) throw new masqueradeErrors.E_MASQUERADE_CONTEXT_CHANGED()
    let companyId: string | null = null
    let effectiveRole: Role | null = null
    if (requestedCompanyId) {
      const actorRole = await this.#authorization.getActiveCompanyRole(
        actor.id,
        requestedCompanyId,
        undefined
      )
      const targetRole = await this.#authorization.getActiveCompanyRole(
        view.targetId,
        requestedCompanyId,
        undefined
      )
      if (actorRole && targetRole && canMasqueradeAs(actorRole, targetRole)) {
        companyId = requestedCompanyId
        effectiveRole = targetRole
      }
    }
    // Another tab of the same sign-in may sit on a company the target does not share. Report the
    // mode where it holds so that tab can adopt the current context and offer End; company reads
    // are still authorized per request by resolveEffectiveReadUser.
    if (!companyId) {
      const memberships = await this.#authorization.listActiveCompanyIds(actor.id, undefined)
      for (const candidate of memberships) {
        const actorRole = await this.#authorization.getActiveCompanyRole(
          actor.id,
          candidate,
          undefined
        )
        const targetRole = await this.#authorization.getActiveCompanyRole(
          view.targetId,
          candidate,
          undefined
        )
        if (actorRole && targetRole && canMasqueradeAs(actorRole, targetRole)) {
          companyId = candidate
          effectiveRole = targetRole
          break
        }
      }
      if (!companyId) throw new masqueradeErrors.E_MASQUERADE_CONTEXT_CHANGED()
    }
    // An empty display name falls through to the email, so these are string-or-empty, not nullable.
    const displayName = target.displayName ?? ''
    const email = target.email
    if (!effectiveRole) throw new masqueradeErrors.E_MASQUERADE_CONTEXT_CHANGED()
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
    }
  }

  /** Starts a read-only masquerade; `expectedContext` is the caller's current context token. */
  async startMasquerade(targetUserId: string, expectedContext: string) {
    const service = await this.#getMasqueradeService()
    return service.start(this.#ctx, { targetId: targetUserId, access: 'view', expectedContext })
  }

  /** Ends the masquerade; `expectedContext` is the caller's current context token. */
  async endMasquerade(expectedContext: string) {
    const service = await this.#getMasqueradeService()
    return service.stop(this.#ctx, { expectedContext })
  }
}
