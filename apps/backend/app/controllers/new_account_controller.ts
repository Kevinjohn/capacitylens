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
import { emailInUseAnswer } from '#services/auth/credential_answers';
import { hasNoCompany } from '#services/installation_company';

/** Open sign-up of a new account. */
export default class NewAccountController {
  /**
   * Open sign-up, when the operator enables it, creates a limited identity that still needs
   * a confirmed address and admission. The first identity always comes from the bootstrap invitation.
   */
  async store({ auth, request, response, logger, serialize }: HttpContext) {
    const body = await request.validateUsing(signUpValidator, { data: request.body() });
    const { email, name } = body;
    if (!capacitylens.allowOpenSignUp || (await hasNoCompany(db))) {
      return response.forbidden({ error: 'Sign-up is closed.', code: 'SIGN_UP_CLOSED' });
    }
    try {
      await accountKit.registration.register({
        email,
        password: body.password,
        registrationData: { name },
      });
    } catch (error) {
      // Keeps the product codes `SIGN_UP_CLOSED` and `EMAIL_IN_USE`, which the Kit's own codes
      // do not carry and the browser reads.
      if (error instanceof FirstCompanyPendingException) {
        return response.forbidden({ error: 'Sign-up is closed.', code: 'SIGN_UP_CLOSED' });
      }
      if (error instanceof RegistrationEmailAlreadyRegisteredError) {
        return response.conflict(emailInUseAnswer);
      }
      // The account exists; only the confirmation email may be missing, and it can be resent.
      if (!isCommittedFailure(error)) throw error;
      logger.warn({ code: 'SIGN_UP_FOLLOW_UP_FAILED' }, 'Sign-up follow-up failed');
    }
    try {
      return response.created(
        await serialize({
          user: await signInWithPassword(auth, logger, {
            email,
            password: body.password,
            clientAddress: request.ip(),
            userAgent: request.header('user-agent'),
          }),
        })
      );
    } catch (error) {
      // Does work: the account exists, so a failed sign-in is logged and answered as sign-in
      // required.
      logger.warn(
        { code: error instanceof Error ? error.name : 'UNKNOWN' },
        'Sign-in after registration failed'
      );
      return response.accepted(await serialize({ accountCreated: true, signInRequired: true }));
    }
  }
}
