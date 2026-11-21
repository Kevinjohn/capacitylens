import type { HttpContext } from '@adonisjs/core/http';
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main';
import {
  InvalidTokenError,
  RegistrationEmailAlreadyRegisteredError,
  isCommittedFailure,
} from '@kevinjohn/adonisjs-account-kit/errors';
import type { Invitation } from '@kevinjohn/adonisjs-account-kit/types';
import { isMailConfigured } from '#services/mail_delivery';
import { setProofHeaders } from '#services/request_helpers';
import { assertCompanyAction } from '#services/auth/authorization';
import { withActor } from '#services/auth/current_actor';
import { getInstallationCompany, getInstallationCompanyId } from '#models/installation_company';
import {
  refuseInvalidAdmission,
  refuseInvalidAdmissionBody,
  refuseMissingAdmission,
} from '#services/admission/errors';
import { signInWithPassword } from '#services/auth/password_sign_in';
import db from '@adonisjs/lucid/services/db';
import type { ProductHttpErrorBody } from '@capacitylens/shared/api/httpErrors';
import { createValidator, signUpValidator } from '#validators/invitations';

function parseInvitationId(value: unknown) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function buildInvitationView(invitation: Invitation) {
  return {
    id: invitation.id,
    role: invitation.role,
    preauthEmail: invitation.email,
    expiresAt: invitation.expiresAt.toISO(),
    createdAt: invitation.createdAt.toISO(),
  };
}

const invalidLink = { error: 'This invitation is invalid or has expired.', code: 'INVALID_TOKEN' };

/**
 * Company invitations through the Account Kit: it owns the token, its one lifetime and the email.
 * The Kit re-checks the sender's authority inside the transaction that stores the invitation.
 */
function sendMailUnavailable(ctx: HttpContext) {
  return ctx.response.serviceUnavailable({
    error: 'Invitations need email delivery. Ask your administrator to configure mail.',
    code: 'MAIL_UNAVAILABLE',
  });
}

export default class InvitationsController {
  /** Confirms the caller manages invitations for this installation's company. */
  private async manager(ctx: HttpContext, companyId: unknown) {
    if (typeof companyId !== 'string' || !companyId) refuseInvalidAdmission();
    return withActor(ctx, async (_actor, trx) => {
      const { actorId } = await assertCompanyAction(companyId, 'invitations:manage', trx);
      if ((await getInstallationCompanyId(trx)) !== companyId) {
        refuseMissingAdmission('Company not found.');
      }
      return actorId;
    });
  }

  async create(ctx: HttpContext) {
    const body = await ctx.request
      .validateUsing(createValidator, { data: ctx.request.body() })
      .catch(refuseInvalidAdmissionBody);
    const { email } = body;
    const actorId = await this.manager(ctx, body.companyId);
    if (!isMailConfigured()) return sendMailUnavailable(ctx);
    try {
      const invitation = await accountKit.invitations.send({
        actorId,
        email,
        role: body.role,
        scope: body.companyId,
      });
      return ctx.response.created({ ...buildInvitationView(invitation), emailed: true });
    } catch (error) {
      // Does work: a committed invitation whose email failed is logged and answered 202.
      if (!isCommittedFailure(error)) throw error;
      ctx.logger.warn({ code: 'INVITATION_DELIVERY_FAILED' }, 'Invitation delivery failed');
      return ctx.response.accepted({ committed: true, emailed: false });
    }
  }

  async index(ctx: HttpContext) {
    const actorId = await this.manager(ctx, ctx.params.companyId);
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
    return ctx.response.ok({ invites });
  }

  async resend(ctx: HttpContext) {
    const id = parseInvitationId(ctx.params.id);
    if (!id) refuseInvalidAdmission();
    const actorId = await this.manager(ctx, ctx.params.companyId);
    // Resending replaces the link, so without mail it would only invalidate a printed one.
    if (!isMailConfigured()) return sendMailUnavailable(ctx);
    try {
      const invitation = await accountKit.invitations.resend({ actorId, invitationId: id });
      return ctx.response.ok({ ...buildInvitationView(invitation), emailed: true });
    } catch (error) {
      // Does work: a committed resend whose email failed is answered 202.
      if (!isCommittedFailure(error)) throw error;
      return ctx.response.accepted({ committed: true, emailed: false });
    }
  }

  async revoke(ctx: HttpContext) {
    const id = parseInvitationId(ctx.params.id);
    if (!id) refuseInvalidAdmission();
    const actorId = await this.manager(ctx, ctx.params.companyId);
    await accountKit.invitations.revoke({ actorId, invitationId: id });
    return ctx.response.noContent();
  }

  /** What the link offers, without spending it. */
  async preview(ctx: HttpContext) {
    setProofHeaders(ctx);
    const invitation = await accountKit.invitations.inspect({ token: ctx.params.token });
    if (!invitation) return ctx.response.notFound(invalidLink);
    const { companyId, accountName } = await getInstallationCompany(db);
    return ctx.response.ok({
      companyId,
      accountName,
      // Before the company exists the role is only bootstrap metadata; setup grants Owner.
      role: companyId ? invitation.role : null,
      email: invitation.email,
    });
  }

  /**
   * Creates the invited identity with a password and signs it in. The Kit refuses an address that
   * already has an account; a repeated request after a lost response gets the invalid-link answer
   * and the person signs in instead.
   */
  async signUp(ctx: HttpContext) {
    setProofHeaders(ctx);
    const body = await ctx.request
      .validateUsing(signUpValidator, { data: ctx.request.body() })
      .catch(refuseInvalidAdmissionBody);
    const { name } = body;
    let email: string;
    try {
      const user = await accountKit.invitations.accept({
        token: ctx.params.token,
        password: body.password,
        registrationData: { name },
      });
      email = user.email;
    } catch (error) {
      // Route wording: acceptance words these refusals for this route; sign-up words them
      // differently.
      if (error instanceof InvalidTokenError) return ctx.response.badRequest(invalidLink);
      if (error instanceof RegistrationEmailAlreadyRegisteredError) {
        return ctx.response.conflict({
          error: 'An account already uses this email. Sign in instead.',
          code: 'EMAIL_REGISTERED',
        } satisfies ProductHttpErrorBody);
      }
      // The identity exists; only a follow-up failed, so the person signs in rather than retrying.
      if (isCommittedFailure(error)) {
        return ctx.response.accepted({ accepted: true, signInRequired: true });
      }
      throw error;
    }
    try {
      return ctx.response.created({
        user: await signInWithPassword(ctx, {
          email,
          password: body.password,
          clientAddress: ctx.request.ip(),
          userAgent: ctx.request.header('user-agent'),
        }),
      });
    } catch (error) {
      // Does work: the account exists, so a failed sign-in is logged and answered as sign-in
      // required.
      ctx.logger.warn(
        { code: error instanceof Error ? error.name : 'UNKNOWN' },
        'Sign-in after invitation acceptance failed'
      );
      return ctx.response.accepted({ accepted: true, signInRequired: true });
    }
  }
}
