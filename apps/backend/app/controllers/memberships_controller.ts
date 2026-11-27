import { inject } from '@adonisjs/core'
import { AdmissionMembershipService } from '#services/membership/admission_membership_service'
import type { HttpContext } from '@adonisjs/core/http'
import { CurrentActorService } from '#services/auth/current_actor_service'

/** The admitted caller's own membership. */
@inject()
export default class MembershipsController {
  #currentActor: CurrentActorService
  #admissionMemberships: AdmissionMembershipService

  constructor(admissionMemberships: AdmissionMembershipService, currentActor: CurrentActorService) {
    this.#admissionMemberships = admissionMemberships
    this.#currentActor = currentActor
  }

  /** Creates the admitted caller's missing membership; never restores or changes one. */
  async store({ auth, serialize }: HttpContext) {
    const result = await this.#currentActor.withActor(auth, (actor, trx) =>
      this.#admissionMemberships.completeMembership(actor.userId, trx)
    )
    return serialize(result)
  }
}
