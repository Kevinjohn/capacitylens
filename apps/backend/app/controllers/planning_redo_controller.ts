import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { planningHistoryStepValidator } from '#validators/planning'
import { PlanningHistoryStepService } from '#services/planning/planning_history_step_service'
import { requestData } from '#validators/request_rules'

/** The planning page's redo. */
@inject()
export default class PlanningRedoController {
  #historySteps: PlanningHistoryStepService

  constructor(historySteps: PlanningHistoryStepService) {
    this.#historySteps = historySteps
  }

  async store({ auth, request, serialize }: HttpContext) {
    const { params, ...input } = await request.validateUsing(planningHistoryStepValidator, {
      data: requestData(request, request.body()),
    })
    return serialize(
      await this.#historySteps.runPlanningHistoryStep(auth, {
        companyId: params.companyId,
        step: 'redo',
        input,
      })
    )
  }
}
