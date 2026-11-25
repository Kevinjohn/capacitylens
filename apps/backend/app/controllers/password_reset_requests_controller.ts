import type { HttpContext } from '@adonisjs/core/http';
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main';
import { E_ACCOUNT_KIT_THROTTLED } from '@kevinjohn/adonisjs-account-kit/errors';
import { isMailConfigured } from '#services/mail_delivery';
import { requestResetValidator } from '#validators/credentials';

/** Requests a password reset link by email. */
export default class PasswordResetRequestsController {
  async store({ request, response, logger, serialize }: HttpContext) {
    if (!isMailConfigured()) {
      return response.notFound({ error: 'Password recovery is unavailable.' });
    }
    const { email } = await request.validateUsing(requestResetValidator, {
      data: request.body(),
    });
    try {
      await accountKit.passwordReset.request({ email, clientKey: request.ip() });
    } catch (error) {
      if (error instanceof E_ACCOUNT_KIT_THROTTLED) throw error;
      // Public recovery does not disclose recipient or delivery state.
      logger.error({ err: error }, 'Password recovery request failed');
    }
    return serialize({ ok: true });
  }
}
