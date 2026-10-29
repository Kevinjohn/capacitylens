import type { ProductHttpErrorBody } from '@capacitylens/shared/api/httpErrors';
import type { HttpContext } from '@adonisjs/core/http';
import accountKit from 'adonisjs-account-kit/services/main';
import {
  IdentityNotConfirmedError,
  InvalidTokenError,
  ThrottledError,
} from 'adonisjs-account-kit/errors';
import { passwordLengthFailure } from '@capacitylens/shared/domain/password';
import { isAccountEmail, normalizeAccountEmail } from '@capacitylens/shared/account/validation';
import env from '#start/env';
import { currentAccount, sessionGuard } from '#services/auth/current_actor';
import { isCommittedFailure } from '#services/account_kit/committed';

function fields(value: unknown, allowed: string[]): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).every((field) => allowed.includes(field))
  );
}

function password(value: unknown): value is string {
  return typeof value === 'string' && !passwordLengthFailure(value);
}

function token(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512;
}

function privateErrorCode(error: unknown) {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  return typeof code === 'string' && /^[A-Z_]{2,64}$/.test(code) ? code : 'RECOVERY_REQUEST_FAILED';
}

/** Keeps bearer links out of shared caches and referrers. */
function proofHeaders(ctx: HttpContext) {
  ctx.response.header('Cache-Control', 'no-store');
  ctx.response.header('Referrer-Policy', 'no-referrer');
}

const committed = {
  error: 'Your password was changed, but a follow-up step failed. Sign in with the new password.',
  code: 'CREDENTIAL_UPDATE_COMMITTED',
  committed: true,
} satisfies ProductHttpErrorBody;

export default class CredentialController {
  async requestReset(ctx: HttpContext) {
    if (!env.get('CAPACITYLENS_MAIL_HOST')) {
      return ctx.response.notFound({ error: 'Password recovery is unavailable.' });
    }
    const body: unknown = ctx.request.body();
    if (!fields(body, ['email']) || typeof body.email !== 'string') {
      return ctx.response.badRequest({ error: 'Invalid recovery request.' });
    }
    const email = normalizeAccountEmail(body.email);
    if (!isAccountEmail(email)) {
      return ctx.response.badRequest({ error: 'Invalid recovery request.' });
    }
    try {
      await accountKit.passwordReset.request({ email, clientKey: ctx.request.ip() });
    } catch (error) {
      if (error instanceof ThrottledError) throw error;
      // Public recovery does not disclose recipient or delivery state.
      ctx.logger.error({ code: privateErrorCode(error) }, 'Password recovery request failed');
    }
    return ctx.response.ok({ ok: true });
  }

  /** Reports whether a reset link is still usable without spending it. */
  async inspectReset(ctx: HttpContext) {
    proofHeaders(ctx);
    const body: unknown = ctx.request.body();
    if (!fields(body, ['token']) || !token(body.token)) {
      return ctx.response.badRequest({ error: 'Invalid recovery request.' });
    }
    return ctx.response.ok({
      valid: await accountKit.passwordReset.inspect({ token: body.token }),
    });
  }

  /** Every sign-in, including any on this device, ends with the old password. */
  async resetPassword(ctx: HttpContext) {
    proofHeaders(ctx);
    const body: unknown = ctx.request.body();
    if (
      !fields(body, ['token', 'newPassword']) ||
      !token(body.token) ||
      !password(body.newPassword)
    ) {
      return ctx.response.badRequest({ error: 'Invalid recovery request.' });
    }
    try {
      await accountKit.passwordReset.reset({ token: body.token, password: body.newPassword });
      return ctx.response.ok({ ok: true });
    } catch (error) {
      if (error instanceof InvalidTokenError) {
        return ctx.response.badRequest({
          error: 'This link is invalid or expired.',
          code: 'INVALID_TOKEN',
        });
      }
      if (isCommittedFailure(error)) return ctx.response.serviceUnavailable(committed);
      throw error;
    }
  }

  /** Changes the password and ends every sign-in, this one included. */
  async changePassword(ctx: HttpContext) {
    const body: unknown = ctx.request.body();
    if (
      !fields(body, ['currentPassword', 'newPassword']) ||
      typeof body.currentPassword !== 'string' ||
      !password(body.newPassword)
    ) {
      return ctx.response.badRequest({ error: 'Invalid credential request.' });
    }
    const account = await currentAccount(ctx);
    let outcome: 'changed' | 'committed' = 'changed';
    try {
      await accountKit.emailPasswordManagement.changePassword({
        actorId: account.id,
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
      });
    } catch (error) {
      if (error instanceof IdentityNotConfirmedError) {
        return ctx.response.forbidden({
          error: 'Current password is incorrect.',
          code: 'CURRENT_PASSWORD_INCORRECT',
        });
      }
      if (!isCommittedFailure(error)) throw error;
      outcome = 'committed';
    }
    await sessionGuard(ctx).terminate();
    if (outcome === 'committed') return ctx.response.serviceUnavailable(committed);
    return ctx.response.ok({ ok: true, signedOut: true });
  }
}
