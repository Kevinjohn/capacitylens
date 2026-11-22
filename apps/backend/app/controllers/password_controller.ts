import type { HttpContext } from '@adonisjs/core/http';
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main';
import {
  IdentityNotConfirmedError,
  isCommittedFailure,
} from '@kevinjohn/adonisjs-account-kit/errors';
import { readCurrentAccount } from '#services/auth/current_actor';
import { managedGuard } from '#services/auth/managed_guard';
import { credentialUpdateCommitted } from '#services/auth/credential_answers';
import { changePasswordValidator } from '#validators/credentials';

/** The signed-in identity's password. */
export default class PasswordController {
  /** Changes the password and ends every sign-in, this one included. */
  async update(ctx: HttpContext) {
    const body = await ctx.request.validateUsing(changePasswordValidator, {
      data: ctx.request.body(),
    });
    const account = await readCurrentAccount(ctx);
    let outcome: 'changed' | 'committed' = 'changed';
    try {
      await accountKit.emailPasswordManagement.changePassword({
        actorId: account.id,
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
      });
    } catch (error) {
      // Does work: a committed change is recorded before the session ends.
      if (error instanceof IdentityNotConfirmedError) {
        return ctx.response.forbidden({
          error: 'Current password is incorrect.',
          code: 'CURRENT_PASSWORD_INCORRECT',
        });
      }
      if (!isCommittedFailure(error)) throw error;
      outcome = 'committed';
    }
    await managedGuard.forRequest(ctx).terminate();
    if (outcome === 'committed') return ctx.response.serviceUnavailable(credentialUpdateCommitted);
    return ctx.response.ok({ ok: true, signedOut: true });
  }
}
