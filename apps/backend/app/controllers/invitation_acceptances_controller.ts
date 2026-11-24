import { inject } from '@adonisjs/core';
import type { HttpContext } from '@adonisjs/core/http';
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main';
import {
  InvalidTokenError,
  RegistrationEmailAlreadyRegisteredError,
  isCommittedFailure,
} from '@kevinjohn/adonisjs-account-kit/errors';
import { setProofHeaders } from '#services/request_helpers';
import { emailInUseAnswer, invalidLinkAnswer } from '#exceptions/credential_answers';
import { PasswordSignInService } from '#services/auth/password_sign_in_service';
import { acceptInvitationSignUpValidator } from '#validators/invitations';

/** Accepting an invitation by creating the invited identity. */
@inject()
export default class InvitationAcceptancesController {
  #passwordSignIn: PasswordSignInService;

  constructor(passwordSignIn: PasswordSignInService) {
    this.#passwordSignIn = passwordSignIn;
  }

  /**
   * Creates the invited identity with a password and signs it in. The Kit refuses an address that
   * already has an account; a repeated request after a lost response gets the invalid-link answer
   * and the person signs in instead.
   */
  async store({ auth, params, request, response, logger, serialize }: HttpContext) {
    setProofHeaders(response);
    const body = await request.validateUsing(acceptInvitationSignUpValidator, {
      data: request.body(),
    });
    const { name } = body;
    let email: string;
    try {
      const user = await accountKit.invitations.accept({
        token: params.token,
        password: body.password,
        registrationData: { name },
      });
      email = user.email;
    } catch (error) {
      // Keeps the product codes `INVALID_TOKEN` and `EMAIL_IN_USE`, which the browser reads and
      // the Kit's own codes do not carry.
      if (error instanceof InvalidTokenError) return response.badRequest(invalidLinkAnswer);
      if (error instanceof RegistrationEmailAlreadyRegisteredError) {
        return response.conflict(emailInUseAnswer);
      }
      // The identity exists; only a follow-up failed, so the person signs in rather than retrying.
      if (isCommittedFailure(error)) {
        return response.accepted(await serialize({ accepted: true, signInRequired: true }));
      }
      throw error;
    }
    try {
      return response.created(
        await serialize({
          user: await this.#passwordSignIn.signInWithPassword(auth, logger, {
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
        'Sign-in after invitation acceptance failed'
      );
      return response.accepted(await serialize({ accepted: true, signInRequired: true }));
    }
  }
}
