import type { HttpContext } from '@adonisjs/core/http';
import { withActor } from '#services/auth/current_actor';
import { completeMembership } from '#services/membership/admission_membership';

/** The admitted caller's own membership. */
export default class MembershipsController {
  /** Creates the admitted caller's missing membership; never restores or changes one. */
  async store({ auth, serialize }: HttpContext) {
    const result = await withActor(auth, (actor, trx) => completeMembership(actor.userId, trx));
    return serialize(result);
  }
}
