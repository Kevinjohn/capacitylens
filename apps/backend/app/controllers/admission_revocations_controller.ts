import { inject } from '@adonisjs/core';
import type { HttpContext } from '@adonisjs/core/http';
import { AdmissionDecisionService } from '#services/admission/admission_decision_service';
import { CurrentActorService } from '#services/auth/current_actor_service';
import { refuseInvalidAdmission } from '#exceptions/admission_errors';

/**
 * An Owner or Admin revokes a person's admission. The Account Kit authorises every decision; it
 * sends no notification.
 */
@inject()
export default class AdmissionRevocationsController {
  #currentActor: CurrentActorService;
  #decisions: AdmissionDecisionService;

  constructor(decisions: AdmissionDecisionService, currentActor: CurrentActorService) {
    this.#decisions = decisions;
    this.#currentActor = currentActor;
  }

  async store({ auth, params, serialize }: HttpContext) {
    const userId = this.#decisions.parseUserId(params.userId);
    if (!userId) refuseInvalidAdmission();
    const actor = await this.#currentActor.readCurrentAccount(auth);
    return serialize(
      await this.#decisions.decide({ actorId: actor.id, userId, decision: 'revoke' })
    );
  }
}
