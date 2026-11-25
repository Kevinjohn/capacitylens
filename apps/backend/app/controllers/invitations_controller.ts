import { inject } from '@adonisjs/core';
import type { HttpContext } from '@adonisjs/core/http';
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main';
import { isCommittedFailure } from '@kevinjohn/adonisjs-account-kit/errors';
import { refuseInvalidAdmission } from '#exceptions/admission_errors';
import { InvitationAnswerService } from '#services/admission/invitation_answer_service';
import { createInvitationValidator } from '#validators/invitations';
import { MailDeliveryService } from '#services/mail_delivery_service';

/**
 * Company invitations through the Account Kit: it owns the token, its one lifetime and the email.
 * The Kit re-checks the sender's access inside the transaction that stores the invitation.
 */
@inject()
export default class InvitationsController {
  #invitations: InvitationAnswerService;
  #mailDelivery: MailDeliveryService;

  constructor(invitations: InvitationAnswerService, mailDelivery: MailDeliveryService) {
    this.#invitations = invitations;
    this.#mailDelivery = mailDelivery;
  }

  async store({ auth, request, response, logger, serialize }: HttpContext) {
    const body = await request.validateUsing(createInvitationValidator, { data: request.body() });
    const { email } = body;
    const actorId = await this.#invitations.requireInvitationManager(auth, body.companyId);
    if (!this.#mailDelivery.isMailConfigured()) {
      return response.serviceUnavailable(this.#invitations.buildMailUnavailableBody());
    }
    try {
      const invitation = await accountKit.invitations.send({
        actorId,
        email,
        role: body.role,
        scope: body.companyId,
      });
      return response.created(
        await serialize({ ...this.#invitations.buildInvitationView(invitation), emailed: true })
      );
    } catch (error) {
      // Does work: a committed invitation whose email failed is logged and answered 202.
      if (!isCommittedFailure(error)) throw error;
      logger.warn({ code: 'INVITATION_DELIVERY_FAILED' }, 'Invitation delivery failed');
      return response.accepted(await serialize({ committed: true, emailed: false }));
    }
  }

  async index({ auth, params, serialize }: HttpContext) {
    const actorId = await this.#invitations.requireInvitationManager(auth, params.companyId);
    // The Kit pages at 100; a small company's open invitations are read in full.
    const invites = [];
    let cursor: string | undefined;
    do {
      const page = await accountKit.invitations.list({
        actorId,
        limit: 100,
        cursor,
        scope: params.companyId as string,
      });
      invites.push(...page.items.map((item) => this.#invitations.buildInvitationView(item)));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return serialize({ invites });
  }

  async destroy({ auth, params, response }: HttpContext) {
    const id = this.#invitations.parseInvitationId(params.id);
    if (!id) refuseInvalidAdmission();
    const actorId = await this.#invitations.requireInvitationManager(auth, params.companyId);
    await accountKit.invitations.revoke({ actorId, invitationId: id });
    return response.noContent();
  }
}
