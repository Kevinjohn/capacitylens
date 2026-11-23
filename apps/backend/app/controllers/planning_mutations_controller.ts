import type { HttpContext } from '@adonisjs/core/http';
import { mutatePlanning } from '#services/planning';
import { planningMutationValidator } from '#validators/planning_operations';
import { withActor } from '#services/auth/current_actor';

/** The one planning mutation route. */
export default class PlanningMutationsController {
  /** Runs one planning operation; the validated intent, not the URL, names it. */
  async store({ request, params, auth, requestLog, serialize }: HttpContext) {
    const input = await request.validateUsing(planningMutationValidator);
    requestLog.planningOperation = input.intent.operation;
    const companyId = String(params.companyId);
    return serialize(
      await withActor(auth, (actor, trx) => mutatePlanning({ trx, actor, companyId, input }))
    );
  }
}
