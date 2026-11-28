import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { AdmissionDecisionService } from '#services/admission/admission_decision_service'
import { decideAdmissionValidator } from '#validators/admission'
import { requestData } from '#validators/request_rules'

/**
 * An Owner or Admin approves a person's admission. The Account Kit authorises every decision; it
 * sends no notification.
 */
@inject()
export default class AdmissionApprovalsController {
  #decisions: AdmissionDecisionService

  constructor(decisions: AdmissionDecisionService) {
    this.#decisions = decisions
  }

  async store({ auth, request, serialize }: HttpContext) {
    const { params } = await request.validateUsing(decideAdmissionValidator, {
      data: requestData(request),
    })
    const { userId } = params
    const actor = auth.getUserOrFail()
    return serialize(
      await this.#decisions.decide({ actorId: actor.id, userId, decision: 'approve' })
    )
  }
}
