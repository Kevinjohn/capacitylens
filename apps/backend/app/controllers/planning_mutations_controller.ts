import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { PlanningService } from '#services/planning_service'
import { planningMutationValidator } from '#validators/planning'
import { CurrentActorService } from '#services/auth/current_actor_service'

/** The one planning mutation route. */
@inject()
export default class PlanningMutationsController {
  #currentActor: CurrentActorService
  #planning: PlanningService

  constructor(currentActor: CurrentActorService, planning: PlanningService) {
    this.#currentActor = currentActor
    this.#planning = planning
  }

  /** Runs one planning operation; the validated intent, not the URL, names it. */
  async store({ request, auth, requestLog, serialize }: HttpContext) {
    const { params, ...input } = await request.validateUsing(planningMutationValidator)
    requestLog.planningOperation = input.intent.operation
    const { companyId } = params
    return serialize(
      await this.#currentActor.withActor(auth, (actor, trx) =>
        this.#planning.mutatePlanning({ trx, actor, companyId, input })
      )
    )
  }
}
