// Resolves the admitted read-only masquerade actor inside a single-connection product
// transaction and exposes the shared Masquerade package service handle.

import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import app from '@adonisjs/core/services/app'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { errors as masqueradeErrors } from '@kevinjohn/adonisjs-masquerade'
import type { MasqueradeService, ModeView } from '@kevinjohn/adonisjs-masquerade'
import { canMasqueradeAs } from '@capacitylens/shared/domain/access'
import IdentityAuthorizationException from '#exceptions/identity_authorization_exception'
import { AuthorizationService } from '#services/auth/authorization_service'
import { CurrentActorService } from '#services/auth/current_actor_service'

export type { ModeView }

/** The shared Masquerade package handle and the effective read actor inside a transaction. */
@inject()
export class MasqueradeModeService {
  #currentActor: CurrentActorService
  #authorization: AuthorizationService

  constructor(currentActor: CurrentActorService, authorization: AuthorizationService) {
    this.#currentActor = currentActor
    this.#authorization = authorization
  }

  /** The Masquerade service the package's provider builds and owns. */
  async getMasqueradeService(): Promise<MasqueradeService<HttpContext>> {
    const runtime = await app.container.make('masquerade.runtime')
    return runtime.service
  }

  /**
   * Resolves only the actor admitted before the product transaction; never substitutes on error.
   * A masquerade whose company access changed is refused with `refuse`: planning passes its
   * `E_ACCOUNT_MEMBERSHIP_LOST`, which tells the browser to drop its planning projection.
   */
  async resolveEffectiveReadUser(
    trx: TransactionClientContract,
    companyId: string | undefined,
    refuse: () => Error = () =>
      new IdentityAuthorizationException('Masquerade company access changed.')
  ) {
    const actor = this.#currentActor.requireActor(trx)
    const context = actor.masqueradeContext
    if (!context || context.actorId !== actor.userId) {
      throw new masqueradeErrors.E_MASQUERADE_CONTEXT_CHANGED()
    }
    if (context.isMasquerading) {
      // Without a company there is no rank to check, so a masquerade never reads company-free.
      if (!companyId) throw refuse()
      const actorRole = await this.#authorization.getActiveCompanyRole(actor.userId, companyId, trx)
      const targetRole = await this.#authorization.getActiveCompanyRole(
        context.effectiveId,
        companyId,
        trx
      )
      if (!actorRole || !targetRole || !canMasqueradeAs(actorRole, targetRole)) {
        throw refuse()
      }
    }
    return {
      actorId: actor.userId,
      effectiveId: context.effectiveId,
      companyId: context.isMasquerading ? (companyId ?? null) : null,
      isMasquerading: context.isMasquerading,
    }
  }
}
