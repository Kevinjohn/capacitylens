import type { HttpContext } from '@adonisjs/core/http';
import { readArchiveRecovery } from '#services/planning';
import { withActor } from '#services/auth/current_actor';

/** The planning page's archive recovery read. */
export default class PlanningArchiveController {
  async show({ auth, params, serialize }: HttpContext) {
    const companyId = String(params.companyId);
    return serialize(await withActor(auth, (_actor, trx) => readArchiveRecovery(trx, companyId)));
  }
}
