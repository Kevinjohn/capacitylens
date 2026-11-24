import { inject } from '@adonisjs/core';
import type { HttpContext } from '@adonisjs/core/http';
import { readPlanning } from '#services/planning';
import { planningReadValidator } from '#validators/planning/read';
import { CurrentActorService } from '#services/auth/current_actor_service';

/** Planning reads. */
@inject()
export default class PlanningController {
  #currentActor: CurrentActorService;

  constructor(currentActor: CurrentActorService) {
    this.#currentActor = currentActor;
  }

  async show({ auth, params, request, serialize }: HttpContext) {
    const companyId = String(params.companyId);
    const { from, to, historyId, ifRevision } = await request.validateUsing(planningReadValidator, {
      data: request.qs(),
    });
    const window = from !== undefined && to !== undefined ? { from, to } : undefined;
    return serialize(
      await this.#currentActor.withActor(auth, (actor, trx) =>
        readPlanning(trx, companyId, window, {
          sessionId: actor.sessionId,
          historyId,
          ifRevision,
        })
      )
    );
  }
}
