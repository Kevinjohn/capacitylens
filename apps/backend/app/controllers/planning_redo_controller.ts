import { inject } from '@adonisjs/core';
import type { HttpContext } from '@adonisjs/core/http';
import { planningHistoryStepValidator } from '#validators/planning_operations';
import { PlanningHistoryStepService } from '#services/planning/planning_history_step_service';

/** The planning page's redo. */
@inject()
export default class PlanningRedoController {
  #historySteps: PlanningHistoryStepService;

  constructor(historySteps: PlanningHistoryStepService) {
    this.#historySteps = historySteps;
  }

  async store({ auth, params, request, serialize }: HttpContext) {
    const input = await request.validateUsing(planningHistoryStepValidator);
    return serialize(
      await this.#historySteps.runPlanningHistoryStep(auth, {
        companyId: params.companyId,
        step: 'redo',
        input,
      })
    );
  }
}
