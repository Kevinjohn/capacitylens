import type { HttpContext } from '@adonisjs/core/http';
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main';
import { isCommittedFailure } from '@kevinjohn/adonisjs-account-kit/errors';
import { isMailConfigured } from '#services/mail_delivery';
import { refuseInvalidAdmission, refuseInvalidAdmissionBody } from '#services/admission/errors';
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
  async store(ctx: HttpContext) {
    const [validationError, body] = await ctx.request.tryValidateUsing(createInvitationValidator, {
      data: ctx.request.body(),
    });
    if (validationError) refuseInvalidAdmissionBody(validationError);
    const { email } = body;
    const actorId = await requireInvitationManager(ctx, body.companyId);
    if (!isMailConfigured()) return answerMailUnavailable(ctx.response);
    try {
      const invitation = await accountKit.invitations.send({
        actorId,
        email,
        role: body.role,
        scope: body.companyId,
      });
      return ctx.response.created(
        await ctx.serialize({ ...buildInvitationView(invitation), emailed: true })
      );
    } catch (error) {
      // Does work: a committed invitation whose email failed is logged and answered 202.
      if (!isCommittedFailure(error)) throw error;
      ctx.logger.warn({ code: 'INVITATION_DELIVERY_FAILED' }, 'Invitation delivery failed');
      return ctx.response.accepted(await ctx.serialize({ committed: true, emailed: false }));
    }
  }

  async index(ctx: HttpContext) {
    const actorId = await requireInvitationManager(ctx, ctx.params.companyId);
    // The Kit pages at 100; a small company's open invitations are read in full.
    const invites = [];
    let cursor: string | undefined;
    do {
      const page = await accountKit.invitations.list({
        actorId,
        limit: 100,
        cursor,
        scope: ctx.params.companyId as string,
      });
      invites.push(...page.items.map(buildInvitationView));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return ctx.serialize({ invites });
  }

  async destroy(ctx: HttpContext) {
    const id = parseInvitationId(ctx.params.id);
    if (!id) refuseInvalidAdmission();
    const actorId = await requireInvitationManager(ctx, ctx.params.companyId);
    await accountKit.invitations.revoke({ actorId, invitationId: id });
    return ctx.response.noContent();
  }
}
