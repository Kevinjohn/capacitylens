import type { ProductHttpErrorBody } from '@capacitylens/shared/api/httpErrors';
import type { HttpContext } from '@adonisjs/core/http';
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main';
import { InvalidTokenError, isCommittedFailure } from '@kevinjohn/adonisjs-account-kit/errors';
import { isMailConfigured } from '#services/mail_delivery';
import { setProofHeaders } from '#services/request_helpers';
import { readCurrentAccount } from '#services/auth/current_actor';
import { completeValidator, inspectValidator } from '#validators/verification';

/** Address confirmation for a signed-in identity, reachable before admission. */
export default class VerificationController {
  async send(ctx: HttpContext) {
    if (!isMailConfigured()) {
      return ctx.response.serviceUnavailable({
        error: 'Email delivery is not configured. Ask your administrator.',
        code: 'MAIL_UNAVAILABLE',
      });
    }
    const account = await readCurrentAccount(ctx);
    try {
      return ctx.response.ok({
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

  /** Reports whether a confirmation link is still usable without spending it. */
  async inspect(ctx: HttpContext) {
    setProofHeaders(ctx);
    const body = await ctx.request.validateUsing(inspectValidator, { data: ctx.request.body() });
    return ctx.response.ok({
      valid: await accountKit.emailVerification.inspect({ token: body.token }),
    });
  }

  /**
   * Spends the link, confirms the address and sets the chosen password. Holding the link already
   * proves the mailbox, which could reset the password anyway.
   */
  async complete(ctx: HttpContext) {
    setProofHeaders(ctx);
    const body = await ctx.request.validateUsing(completeValidator, { data: ctx.request.body() });
    try {
      await accountKit.emailVerification.complete({
        token: body.token,
        password: body.password,
      });
      return ctx.response.ok({ result: 'verified' });
    } catch (error) {
      // Route wording: completion answers INVALID_TOKEN where the handler sends the Kit's own code.
      if (error instanceof InvalidTokenError) {
        return ctx.response.badRequest({
          error: 'This link is invalid or expired.',
          code: 'INVALID_TOKEN',
        });
      }
      if (isCommittedFailure(error)) {
        return ctx.response.serviceUnavailable({
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
