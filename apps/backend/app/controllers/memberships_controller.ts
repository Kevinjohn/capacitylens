import { inject } from '@adonisjs/core';
import { AdmissionMembershipService } from '#services/membership/admission_membership_service';
import type { HttpContext } from '@adonisjs/core/http';
import { withActor } from '#services/auth/current_actor';

/** The admitted caller's own membership. */
@inject()
export default class MembershipsController {
  #admissionMemberships: AdmissionMembershipService;

  constructor(admissionMemberships: AdmissionMembershipService) {
    this.#admissionMemberships = admissionMemberships;
  }

  /** Creates the admitted caller's missing membership; never restores or changes one. */
  async store({ auth, serialize }: HttpContext) {
    const result = await withActor(auth, (actor, trx) =>
      this.#admissionMemberships.completeMembership(actor.userId, trx)
    );
    return serialize(result);
  }
}
