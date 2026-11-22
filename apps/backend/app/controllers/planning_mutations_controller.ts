import type { HttpContext } from '@adonisjs/core/http';
import { mutatePlanning } from '#services/planning';
import { planningMutationValidator } from '#validators/planning_operations';
import { withActor } from '#services/auth/current_actor';

/** The one planning mutation route. */
export default class PlanningMutationsController {
  /** Runs one planning operation; the validated intent, not the URL, names it. */
  async store(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(planningMutationValidator);
    ctx.planningOperation = input.intent.operation;
    const companyId = String(ctx.params.companyId);
    return ctx.serialize(
      await withActor(ctx, (actor, trx) => mutatePlanning({ trx, actor, companyId, input }))
    );
  }
}
