import type { ProductHttpErrorBody } from '@capacitylens/shared/api/httpErrors';
import type { HttpContext } from '@adonisjs/core/http';
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main';
import { InvalidTokenError } from '@kevinjohn/adonisjs-account-kit/errors';
import { passwordLengthFailure } from '@capacitylens/shared/domain/password';
import { isMailConfigured } from '#services/mail_delivery';
import { hasOnlyFields, proofHeaders } from '#services/request_helpers';
import { currentAccount } from '#services/auth/current_actor';
import { isCommittedFailure } from '#services/account_kit/committed';

function tokenBody(value: unknown, extra: string[] = []): Record<string, unknown> | null {
  const body = value;
  if (!hasOnlyFields(body, ['token', ...extra])) return null;
  return typeof body.token === 'string' && body.token.length > 0 && body.token.length <= 512
    ? body
    : null;
}

/** Address confirmation for a signed-in identity, reachable before admission. */
export default class VerificationController {
  async send(ctx: HttpContext) {
    if (!isMailConfigured()) {
      return ctx.response.serviceUnavailable({
        error: 'Email delivery is not configured. Ask your administrator.',
        code: 'MAIL_UNAVAILABLE',
      });
    }
    const account = await currentAccount(ctx);
    try {
      return ctx.response.ok({
        result: await accountKit.emailVerification.send({ userId: account.id }),
      });
    } catch (error) {
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
    proofHeaders(ctx);
    const body = tokenBody(ctx.request.body());
    if (!body) return ctx.response.badRequest({ error: 'Invalid confirmation request.' });
    return ctx.response.ok({
      valid: await accountKit.emailVerification.inspect({ token: body.token as string }),
    });
  }

  /**
   * Spends the link, confirms the address and sets the chosen password. Holding the link already
   * proves the mailbox, which could reset the password anyway.
   */
  async complete(ctx: HttpContext) {
    proofHeaders(ctx);
    const body = tokenBody(ctx.request.body(), ['password']);
    if (!body || typeof body.password !== 'string' || passwordLengthFailure(body.password)) {
      return ctx.response.badRequest({ error: 'Invalid confirmation request.' });
    }
    try {
      await accountKit.emailVerification.complete({
        token: body.token as string,
        password: body.password,
      });
      return ctx.response.ok({ result: 'verified' });
    } catch (error) {
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
