import { inject } from '@adonisjs/core'
import { exportQueryValidator } from '#validators/export_query'
import type { HttpContext } from '@adonisjs/core/http'
import { transformState } from '#transformers/state_transformer'
import { AuthorizationService } from '#services/auth/authorization_service'
import IdentityAuthorizationException from '#exceptions/identity_authorization_exception'
import { MasqueradeModeService } from '#services/auth/masquerade_mode_service'
import { CurrentActorService } from '#services/auth/current_actor_service'
import { StateRepositoryService } from '#services/state_repository_service'

/** The company's state as the effective member may read it. */
@inject()
export default class CompanyStateController {
  #authorization: AuthorizationService
  #masqueradeModes: MasqueradeModeService
  #currentActor: CurrentActorService
  #stateRepository: StateRepositoryService

  constructor(
    authorization: AuthorizationService,
    masqueradeModes: MasqueradeModeService,
    currentActor: CurrentActorService,
    stateRepository: StateRepositoryService
  ) {
    this.#authorization = authorization
    this.#masqueradeModes = masqueradeModes
    this.#currentActor = currentActor
    this.#stateRepository = stateRepository
  }

  async show({ auth, request, serialize }: HttpContext) {
    const { companyId, includeInactive } = await request.validateUsing(exportQueryValidator, {
      data: request.qs(),
    })
    return serialize(
      await this.#currentActor.withActor(auth, async (_actor, trx) => {
        // Under view-as this also refuses unless the actor may view the named company as its member.
        const user = await this.#masqueradeModes.resolveEffectiveReadUser(trx, companyId)
        const role = await this.#authorization.getActiveCompanyRole(
          user.effectiveId,
          companyId,
          trx
        )
        if (!role) throw new IdentityAuthorizationException()
        if (includeInactive === '1' && !this.#stateRepository.mayReadInactive(role)) {
          throw new IdentityAuthorizationException()
        }
        const state = await this.#stateRepository.readStateWithClient(
          trx,
          companyId,
          includeInactive === '1'
        )
        return transformState(state, companyId, role)
      })
    )
  }
}
