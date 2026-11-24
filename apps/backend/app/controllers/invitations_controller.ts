import type { HttpContext } from '@adonisjs/core/http';
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main';
import { isCommittedFailure } from '@kevinjohn/adonisjs-account-kit/errors';
import { isMailConfigured } from '#services/mail_delivery';
import { refuseInvalidAdmission } from '#exceptions/admission_errors';
import {
  answerMailUnavailable,
  buildInvitationView,
  parseInvitationId,
  requireInvitationManager,
} from '#services/admission/invitation_answers';
import { createInvitationValidator } from '#validators/invitations';

/**
 * Company invitations through the Account Kit: it owns the token, its one lifetime and the email.
 * The Kit re-checks the sender's access inside the transaction that stores the invitation.
 */
export default class InvitationsController {
  async store({ auth, request, response, logger, serialize }: HttpContext) {
    const body = await request.validateUsing(createInvitationValidator, { data: request.body() });
    const { email } = body;
    const actorId = await requireInvitationManager(auth, body.companyId);
    if (!isMailConfigured()) return answerMailUnavailable(response);
    try {
      const invitation = await accountKit.invitations.send({
        actorId,
        email,
        role: body.role,
        scope: body.companyId,
      });
      return response.created(
        await serialize({ ...buildInvitationView(invitation), emailed: true })
      );
    } catch (error) {
      // Does work: a committed invitation whose email failed is logged and answered 202.
      if (!isCommittedFailure(error)) throw error;
      logger.warn({ code: 'INVITATION_DELIVERY_FAILED' }, 'Invitation delivery failed');
      return response.accepted(await serialize({ committed: true, emailed: false }));
    }
  }

  async index({ auth, params, serialize }: HttpContext) {
    const actorId = await requireInvitationManager(auth, params.companyId);
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
      invites.push(...page.items.map(buildInvitationView));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return serialize({ invites });
  }

  async destroy({ auth, params, response }: HttpContext) {
    const id = parseInvitationId(params.id);
    if (!id) refuseInvalidAdmission();
    const actorId = await requireInvitationManager(auth, params.companyId);
    await accountKit.invitations.revoke({ actorId, invitationId: id });
    return response.noContent();
  }
}
