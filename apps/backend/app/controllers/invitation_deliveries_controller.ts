import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main'
import { isCommittedFailure } from '@kevinjohn/adonisjs-account-kit/errors'
import { InvitationAnswerService } from '#services/admission/invitation_answer_service'
import { MailDeliveryService } from '#services/mail_delivery_service'
import { resendInvitationValidator } from '#validators/invitations'
import { requestData } from '#validators/request_rules'

/** Sends an open invitation again with a new link. */
@inject()
export default class InvitationDeliveriesController {
  #invitations: InvitationAnswerService
  #mailDelivery: MailDeliveryService

  constructor(invitations: InvitationAnswerService, mailDelivery: MailDeliveryService) {
    this.#invitations = invitations
    this.#mailDelivery = mailDelivery
  }

  async store({ auth, request, response, serialize }: HttpContext) {
    const { params } = await request.validateUsing(resendInvitationValidator, {
      data: requestData(request),
    })
    const { id } = params
    const actorId = await this.#invitations.requireInvitationManager(auth, params.companyId)
    // Resending replaces the link, so without mail it would only invalidate a printed one.
    if (!this.#mailDelivery.isMailConfigured()) {
      return response.serviceUnavailable(this.#invitations.buildMailUnavailableBody())
    }
    try {
      const invitation = await accountKit.invitations.resend({ actorId, invitationId: id })
      return serialize({ ...this.#invitations.buildInvitationView(invitation), emailed: true })
    } catch (error) {
      // Does work: a committed resend whose email failed is answered 202.
      if (!isCommittedFailure(error)) throw error
      return response.accepted(await serialize({ committed: true, emailed: false }))
    }
  }
}
