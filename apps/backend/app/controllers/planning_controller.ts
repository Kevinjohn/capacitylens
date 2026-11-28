import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { PlanningService } from '#services/planning_service'
import { planningReadValidator } from '#validators/planning'
import { CurrentActorService } from '#services/auth/current_actor_service'

/** Planning reads. */
@inject()
export default class PlanningController {
  #currentActor: CurrentActorService
  #planning: PlanningService

  constructor(currentActor: CurrentActorService, planning: PlanningService) {
    this.#currentActor = currentActor
    this.#planning = planning
  }

  async show({ auth, request, serialize }: HttpContext) {
    const { historyId, ifRevision, params } = await request.validateUsing(planningReadValidator)
    const { companyId } = params
    return serialize(
      await this.#currentActor.withActor(auth, (actor, trx) =>
        this.#planning.readPlanning(trx, companyId, {
          sessionId: actor.sessionId,
          historyId,
          ifRevision,
        })
      )
    )
  }
}
