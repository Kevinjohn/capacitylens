import type { HttpContext } from '@adonisjs/core/http';
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main';
import { InvalidTokenError, isCommittedFailure } from '@kevinjohn/adonisjs-account-kit/errors';
import { setProofHeaders } from '#services/request_helpers';
import { credentialUpdateCommitted } from '#services/auth/credential_answers';
import { inspectResetValidator, resetPasswordValidator } from '#validators/credentials';

/** A password reset link: whether it is still usable, and spending it to set a new password. */
export default class PasswordResetsController {
  /** Reports whether a reset link is still usable without spending it. */
  async show({ request, response }: HttpContext) {
    setProofHeaders(response);
    const body = await request.validateUsing(inspectResetValidator, {
      data: request.body(),
    });
    return response.ok({
      valid: await accountKit.passwordReset.inspect({ token: body.token }),
    });
  }

  /** Every sign-in, including any on this device, ends with the old password. */
  async update({ request, response }: HttpContext) {
    setProofHeaders(response);
    const body = await request.validateUsing(resetPasswordValidator, {
      data: request.body(),
    });
    try {
      await accountKit.passwordReset.reset({ token: body.token, password: body.newPassword });
      return response.ok({ ok: true });
    } catch (error) {
      // Route wording: reset answers INVALID_TOKEN where the handler sends the Kit's own code.
      if (error instanceof InvalidTokenError) {
        return response.badRequest({
          error: 'This link is invalid or expired.',
          code: 'INVALID_TOKEN',
        });
      }
      if (isCommittedFailure(error)) return response.serviceUnavailable(credentialUpdateCommitted);
      throw error;
    }
  }
}
