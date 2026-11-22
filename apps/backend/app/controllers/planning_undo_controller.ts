import type { HttpContext } from '@adonisjs/core/http';
import { planningHistoryStepValidator } from '#validators/planning_operations';
import { runPlanningHistoryStep } from '#services/planning/history_step';

/** The planning page's undo. */
export default class PlanningUndoController {
  async store(ctx: HttpContext) {
    return ctx.serialize(
      await runPlanningHistoryStep(ctx, 'undo', () =>
        ctx.request.validateUsing(planningHistoryStepValidator)
      )
    );
  }
}
