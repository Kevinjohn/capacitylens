import type { HttpContext } from '@adonisjs/core/http';
import { readArchiveRecovery } from '#services/planning';
import { withActor } from '#services/auth/current_actor';

/** The planning page's archive recovery read. */
export default class PlanningArchiveController {
  async show(ctx: HttpContext) {
    const companyId = String(ctx.params.companyId);
    return withActor(ctx, (_actor, trx) => readArchiveRecovery(trx, companyId));
  }
}
