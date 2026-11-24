import type { HttpContext } from '@adonisjs/core/http';
import { planningHistoryStepValidator } from '#validators/planning_operations';
import { runPlanningHistoryStep } from '#services/planning/history_step';

/** The planning page's redo. */
export default class PlanningRedoController {
  async store({ auth, params, request, serialize }: HttpContext) {
    const input = await request.validateUsing(planningHistoryStepValidator);
    return serialize(
      await runPlanningHistoryStep(auth, { companyId: params.companyId, step: 'redo', input })
    );
  }
}
