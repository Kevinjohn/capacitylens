import { inject } from '@adonisjs/core';
import type { HttpContext } from '@adonisjs/core/http';
import { readArchiveRecovery } from '#services/planning';
import { CurrentActorService } from '#services/auth/current_actor_service';

/** The planning page's archive recovery read. */
@inject()
export default class PlanningArchiveController {
  #currentActor: CurrentActorService;

  constructor(currentActor: CurrentActorService) {
    this.#currentActor = currentActor;
  }

  async show({ auth, params, serialize }: HttpContext) {
    const companyId = String(params.companyId);
    return serialize(
      await this.#currentActor.withActor(auth, (_actor, trx) => readArchiveRecovery(trx, companyId))
    );
  }
}
