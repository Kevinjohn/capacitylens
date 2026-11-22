import type { HttpContext } from '@adonisjs/core/http';
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main';
import { isCommittedFailure } from '@kevinjohn/adonisjs-account-kit/errors';
import { isMailConfigured } from '#services/mail_delivery';
import { refuseInvalidAdmission } from '#services/admission/errors';
import {
  answerMailUnavailable,
  buildInvitationView,
  parseInvitationId,
  requireInvitationManager,
} from '#services/admission/invitation_answers';

/** Sends an open invitation again with a new link. */
export default class InvitationDeliveriesController {
  async store(ctx: HttpContext) {
    const id = parseInvitationId(ctx.params.id);
    if (!id) refuseInvalidAdmission();
    const actorId = await requireInvitationManager(ctx, ctx.params.companyId);
    // Resending replaces the link, so without mail it would only invalidate a printed one.
    if (!isMailConfigured()) return answerMailUnavailable(ctx.response);
    try {
      const invitation = await accountKit.invitations.resend({ actorId, invitationId: id });
      return ctx.response.ok({ ...buildInvitationView(invitation), emailed: true });
    } catch (error) {
      // Does work: a committed resend whose email failed is answered 202.
      if (!isCommittedFailure(error)) throw error;
      return ctx.response.accepted({ committed: true, emailed: false });
    }
  }
}
