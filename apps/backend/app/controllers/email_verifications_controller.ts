import type { ProductHttpErrorBody } from '@capacitylens/shared/api/httpErrors';
import type { HttpContext } from '@adonisjs/core/http';
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main';
import { InvalidTokenError, isCommittedFailure } from '@kevinjohn/adonisjs-account-kit/errors';
import { setProofHeaders } from '#services/request_helpers';
import { invalidLinkAnswer } from '#services/auth/credential_answers';
import {
  completeVerificationValidator,
  inspectVerificationValidator,
} from '#validators/verification';

/** Address confirmation for a signed-in identity, reachable before admission: spending the link. */
export default class EmailVerificationsController {
  /** Reports whether a confirmation link is still usable without spending it. */
  async show({ request, response, serialize }: HttpContext) {
    setProofHeaders(response);
    const body = await request.validateUsing(inspectVerificationValidator, {
      data: request.body(),
    });
    return serialize({
      valid: await accountKit.emailVerification.inspect({ token: body.token }),
    });
  }

  /**
   * Spends the link, confirms the address and sets the chosen password. Holding the link already
   * proves the mailbox, which could reset the password anyway.
   */
  async update({ request, response, serialize }: HttpContext) {
    setProofHeaders(response);
    const body = await request.validateUsing(completeVerificationValidator, {
      data: request.body(),
    });
    try {
      await accountKit.emailVerification.complete({
        token: body.token,
        password: body.password,
      });
      return serialize({ result: 'verified' });
    } catch (error) {
      // Keeps `INVALID_TOKEN`, which the browser reads, where the handler sends the Kit's own code.
      if (error instanceof InvalidTokenError) {
        return response.badRequest(invalidLinkAnswer);
      }
      if (isCommittedFailure(error)) {
        return response.serviceUnavailable({
          error:
            'Your address is confirmed and your password is set. Sign in with the new password.',
          code: 'VERIFICATION_COMMITTED',
          committed: true,
        } satisfies ProductHttpErrorBody);
      }
      throw error;
    }
  }
}
