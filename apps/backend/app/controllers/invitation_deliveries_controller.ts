import { inject } from '@adonisjs/core';
import type { HttpContext } from '@adonisjs/core/http';
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main';
import { isCommittedFailure } from '@kevinjohn/adonisjs-account-kit/errors';
import { isMailConfigured } from '#services/mail_delivery';
import { refuseInvalidAdmission } from '#exceptions/admission_errors';
import { InvitationAnswerService } from '#services/admission/invitation_answer_service';

/** Sends an open invitation again with a new link. */
@inject()
export default class InvitationDeliveriesController {
  #invitations: InvitationAnswerService;

  constructor(invitations: InvitationAnswerService) {
    this.#invitations = invitations;
  }

  async store({ auth, params, response, serialize }: HttpContext) {
    const id = this.#invitations.parseInvitationId(params.id);
    if (!id) refuseInvalidAdmission();
    const actorId = await this.#invitations.requireInvitationManager(auth, params.companyId);
    // Resending replaces the link, so without mail it would only invalidate a printed one.
    if (!isMailConfigured()) {
      return response.serviceUnavailable(this.#invitations.buildMailUnavailableBody());
    }
    try {
      const invitation = await accountKit.invitations.resend({ actorId, invitationId: id });
      return serialize({ ...this.#invitations.buildInvitationView(invitation), emailed: true });
    } catch (error) {
      // Does work: a committed resend whose email failed is answered 202.
      if (!isCommittedFailure(error)) throw error;
      return response.accepted(await serialize({ committed: true, emailed: false }));
    }
  }
}
