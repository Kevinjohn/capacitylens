import { inject } from '@adonisjs/core';
import type { HttpContext } from '@adonisjs/core/http';
import { AdmissionDecisionService } from '#services/admission/admission_decision_service';
import { readCurrentAccount } from '#services/auth/current_actor';
import { refuseInvalidAdmission } from '#exceptions/admission_errors';

/**
 * An Owner or Admin approves a person's admission. The Account Kit authorises every decision; it
 * sends no notification.
 */
@inject()
export default class AdmissionApprovalsController {
  #decisions: AdmissionDecisionService;

  constructor(decisions: AdmissionDecisionService) {
    this.#decisions = decisions;
  }

  async store({ auth, params, serialize }: HttpContext) {
    const userId = this.#decisions.parseUserId(params.userId);
    if (!userId) refuseInvalidAdmission();
    const actor = await readCurrentAccount(auth);
    return serialize(
      await this.#decisions.decide({ actorId: actor.id, userId, decision: 'approve' })
    );
  }
}
