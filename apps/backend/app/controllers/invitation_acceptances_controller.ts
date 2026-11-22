import type { HttpContext } from '@adonisjs/core/http';
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main';
import {
  InvalidTokenError,
  RegistrationEmailAlreadyRegisteredError,
  isCommittedFailure,
} from '@kevinjohn/adonisjs-account-kit/errors';
import { setProofHeaders } from '#services/request_helpers';
import { refuseInvalidAdmissionBody } from '#services/admission/errors';
import { invalidInvitationLink } from '#services/admission/invitation_answers';
import { signInWithPassword } from '#services/auth/password_sign_in';
import type { ProductHttpErrorBody } from '@capacitylens/shared/api/httpErrors';
import { acceptInvitationSignUpValidator } from '#validators/invitations';

/** Accepting an invitation by creating the invited identity. */
export default class InvitationAcceptancesController {
  /**
   * Creates the invited identity with a password and signs it in. The Kit refuses an address that
   * already has an account; a repeated request after a lost response gets the invalid-link answer
   * and the person signs in instead.
   */
  async store(ctx: HttpContext) {
    setProofHeaders(ctx.response);
    const [validationError, body] = await ctx.request.tryValidateUsing(
      acceptInvitationSignUpValidator,
      { data: ctx.request.body() }
    );
    if (validationError) refuseInvalidAdmissionBody(validationError);
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
      if (error instanceof InvalidTokenError) return ctx.response.badRequest(invalidInvitationLink);
      if (error instanceof RegistrationEmailAlreadyRegisteredError) {
        return ctx.response.conflict({
          error: 'An account already uses this email. Sign in instead.',
          code: 'EMAIL_IN_USE',
        } satisfies ProductHttpErrorBody);
      }
      // The identity exists; only a follow-up failed, so the person signs in rather than retrying.
      if (isCommittedFailure(error)) {
        return ctx.response.accepted(await ctx.serialize({ accepted: true, signInRequired: true }));
      }
      throw error;
    }
    try {
      return ctx.response.created(
        await ctx.serialize({
          user: await signInWithPassword(ctx, {
            email,
            password: body.password,
            clientAddress: ctx.request.ip(),
            userAgent: ctx.request.header('user-agent'),
          }),
        })
      );
    } catch (error) {
      // Does work: the account exists, so a failed sign-in is logged and answered as sign-in
      // required.
      ctx.logger.warn(
        { code: error instanceof Error ? error.name : 'UNKNOWN' },
        'Sign-in after invitation acceptance failed'
      );
      return ctx.response.accepted(await ctx.serialize({ accepted: true, signInRequired: true }));
    }
  }
}
