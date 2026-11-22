import type { HttpContext } from '@adonisjs/core/http';
import { readPlanning } from '#services/planning';
import { planningReadValidator } from '#validators/planning/read';
import { withActor } from '#services/auth/current_actor';

/** Planning reads. */
export default class PlanningController {
  async show(ctx: HttpContext) {
    const companyId = String(ctx.params.companyId);
    const { from, to, historyId, ifRevision } = await ctx.request.validateUsing(
      planningReadValidator,
      {
        data: ctx.request.qs(),
      }
    );
    const window = from !== undefined && to !== undefined ? { from, to } : undefined;
    return withActor(ctx, (actor, trx) =>
      readPlanning(trx, companyId, window, {
        sessionId: actor.sessionId,
        historyId,
        ifRevision,
      })
    );
  }
}
