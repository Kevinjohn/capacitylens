import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { planningHistoryStepValidator } from '#validators/planning'
import { PlanningHistoryStepService } from '#services/planning/planning_history_step_service'

/** The planning page's undo. */
@inject()
export default class PlanningUndoController {
  #historySteps: PlanningHistoryStepService

  constructor(historySteps: PlanningHistoryStepService) {
    this.#historySteps = historySteps
  }

  async store({ auth, request, serialize }: HttpContext) {
    const { params, ...input } = await request.validateUsing(planningHistoryStepValidator)
    return serialize(
      await this.#historySteps.runPlanningHistoryStep(auth, {
        companyId: params.companyId,
        step: 'undo',
        input,
      })
    )
  }
}
