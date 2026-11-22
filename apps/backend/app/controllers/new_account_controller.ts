import type { HttpContext } from '@adonisjs/core/http';
import db from '@adonisjs/lucid/services/db';
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main';
import {
  RegistrationEmailAlreadyRegisteredError,
  isCommittedFailure,
} from '@kevinjohn/adonisjs-account-kit/errors';
import capacitylens from '#config/capacitylens';
import { FirstCompanyPendingException } from '#exceptions/first_company_pending_exception';
import { signInWithPassword } from '#services/auth/password_sign_in';
import { signUpValidator } from '#validators/auth_requests';
import type { ProductHttpErrorBody } from '@capacitylens/shared/api/httpErrors';
import { hasNoCompany } from '#services/installation_company';
import { requireAuthRequestMessage } from '#services/auth/auth_request_message';

/** Open registration of a new account. */
export default class NewAccountController {
  /**
   * Open registration, when the operator enables it, creates a limited identity that still needs
   * a confirmed address and admission. The first identity always comes from the bootstrap invitation.
   */
  async store(ctx: HttpContext) {
    const [validationError, body] = await ctx.request.tryValidateUsing(signUpValidator, {
      data: ctx.request.body(),
    });
    // Route wording: sign-up answers a Vine failure with its own sentence and no code.
    if (validationError) {
      return ctx.response.badRequest({
        error: requireAuthRequestMessage(validationError, 'sign-up'),
      });
    }
    const { email, name } = body;
    if (!capacitylens.allowOpenSignUp || (await hasNoCompany(db))) {
      return ctx.response.forbidden({ error: 'Sign-up is closed.', code: 'SIGN_UP_CLOSED' });
    }
    try {
      await accountKit.registration.register({
        email,
        password: body.password,
        registrationData: { name },
      });
    } catch (error) {
      // Route wording: sign-up words these refusals for this route; invitations word them
      // differently.
      if (error instanceof FirstCompanyPendingException) {
        return ctx.response.forbidden({ error: 'Sign-up is closed.', code: 'SIGN_UP_CLOSED' });
      }
      if (error instanceof RegistrationEmailAlreadyRegisteredError) {
        return ctx.response.conflict({
          error: 'An account already uses this email. Sign in or reset your password.',
          code: 'EMAIL_REGISTERED',
        } satisfies ProductHttpErrorBody);
      }
      // The account exists; only the confirmation email may be missing, and it can be resent.
      if (!isCommittedFailure(error)) throw error;
      ctx.logger.warn({ code: 'REGISTRATION_FOLLOW_UP_FAILED' }, 'Registration follow-up failed');
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
        'Sign-in after registration failed'
      );
      return ctx.response.accepted(
        await ctx.serialize({ accountCreated: true, signInRequired: true })
      );
    }
  }
}
