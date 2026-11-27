import { inject } from '@adonisjs/core'
import { MemberSignInTrackingService } from '#services/membership/member_sign_in_tracking_service'
import type { HttpContext } from '@adonisjs/core/http'
import { AuthorizationService } from '#services/auth/authorization_service'
import { CurrentActorService } from '#services/auth/current_actor_service'
import { updateMemberTrackingValidator } from '#validators/member'
import { requestData } from '#validators/request_rules'

/** Whether the company records its members' sign-ins. */
@inject()
export default class MemberSignInTrackingController {
  #authorization: AuthorizationService
  #currentActor: CurrentActorService
  #signInTracking: MemberSignInTrackingService

  constructor(
    signInTracking: MemberSignInTrackingService,
    authorization: AuthorizationService,
    currentActor: CurrentActorService
  ) {
    this.#signInTracking = signInTracking
    this.#authorization = authorization
    this.#currentActor = currentActor
  }

  async update({ auth, request, serialize }: HttpContext) {
    const { enabled, params } = await request.validateUsing(updateMemberTrackingValidator, {
      data: requestData(request, request.body()),
    })
    const { companyId } = params
    await this.#currentActor.withActor(auth, async (_actor, trx) => {
      const actor = await this.#authorization.assertCompanyPermission(
        companyId,
        'members:signInTracking',
        trx
      )
      await this.#signInTracking.changeTracking(trx, {
        companyId,
        actorId: actor.actorId,
        enabled,
      })
    })
    return serialize({ enabled })
  }
}
