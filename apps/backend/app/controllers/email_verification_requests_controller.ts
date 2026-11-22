import type { HttpContext } from '@adonisjs/core/http';
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main';
import { isCommittedFailure } from '@kevinjohn/adonisjs-account-kit/errors';
import { isMailConfigured } from '#services/mail_delivery';
import { readCurrentAccount } from '#services/auth/current_actor';

/** Address confirmation for a signed-in identity, reachable before admission: sending the link. */
export default class EmailVerificationRequestsController {
  async store(ctx: HttpContext) {
    if (!isMailConfigured()) {
      return ctx.response.serviceUnavailable({
        error: 'Email delivery is not configured. Ask your administrator.',
        code: 'MAIL_UNAVAILABLE',
      });
    }
    const account = await readCurrentAccount(ctx);
    try {
      return ctx.serialize({
        result: await accountKit.emailVerification.send({ userId: account.id }),
      });
    } catch (error) {
      // Does work: a committed address whose email failed is logged and answered 503.
      if (!isCommittedFailure(error)) throw error;
      ctx.logger.warn({ code: 'VERIFICATION_DELIVERY_FAILED' }, 'Verification delivery failed');
      return ctx.response.serviceUnavailable({
        error: 'The confirmation email could not be sent. Try again later.',
        code: 'MAIL_UNAVAILABLE',
      });
    }
  }
}
