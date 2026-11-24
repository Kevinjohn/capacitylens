import { inject } from '@adonisjs/core';
import type { HttpContext } from '@adonisjs/core/http';
import { PlanningService } from '#services/planning_service';
import { CurrentActorService } from '#services/auth/current_actor_service';

/** The planning page's archive recovery read. */
@inject()
export default class PlanningArchiveController {
  #currentActor: CurrentActorService;
  #planning: PlanningService;

  constructor(currentActor: CurrentActorService, planning: PlanningService) {
    this.#currentActor = currentActor;
    this.#planning = planning;
  }

  async show({ auth, params, serialize }: HttpContext) {
    const companyId = String(params.companyId);
    return serialize(
      await this.#currentActor.withActor(auth, (_actor, trx) =>
        this.#planning.readArchiveRecovery(trx, companyId)
      )
    );
  }
}
