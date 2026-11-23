import type { ProductHttpErrorBody } from '@capacitylens/shared/api/httpErrors';
import type { HttpContext } from '@adonisjs/core/http';
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main';
import passwordConfirmations from '@kevinjohn/adonisjs-confirm-action-with-password/services/main';
import {
  IdentityNotConfirmedError,
  isCommittedFailure,
} from '@kevinjohn/adonisjs-account-kit/errors';
import { deleteAccountValidator } from '#validators/credentials';

const deletionCommitted = {
  error: 'Your account was deleted, but a follow-up step failed. You are signed out.',
  code: 'ACCOUNT_DELETION_COMMITTED',
  committed: true,
} satisfies ProductHttpErrorBody;

/** The signed-in identity's own account. */
export default class AccountController {
  /**
   * Deletes the signed-in identity with its memberships and member links, then ends this sign-in.
   * The password is checked by issuing and spending a `delete-account` password confirmation, scoped
   * to the person's id with no company access, just before Account Kit's deletion transaction.
   * That gives deletion the same wrong-password limit and refusal as other sensitive actions. The
   * Kit's own current-password check stays because it cannot be turned off. An Owner transfers
   * ownership first.
   */
  async destroy({ auth, request, response, serialize }: HttpContext) {
    const body = await request.validateUsing(deleteAccountValidator, {
      data: request.body(),
    });
    const input = await auth.use('web').current();
    const confirmation = { action: 'delete-account', scope: String(input.userId), intent: {} };
    const { confirmationId } = await passwordConfirmations.confirmPassword(input, {
      ...confirmation,
      password: body.currentPassword,
    });
    await passwordConfirmations.withConfirmation(
      input,
      { ...confirmation, confirmationId },
      async () => {}
    );
    let outcome: 'deleted' | 'committed' = 'deleted';
    try {
      await accountKit.accountData.delete({
        actorId: input.userId,
        currentPassword: body.currentPassword,
      });
    } catch (error) {
      // Does work: a committed deletion is recorded before the session ends.
      if (error instanceof IdentityNotConfirmedError) {
        return response.forbidden({
          error: 'Current password is incorrect.',
          code: 'CURRENT_PASSWORD_INCORRECT',
        });
      }
      if (!isCommittedFailure(error)) throw error;
      outcome = 'committed';
    }
    await auth.use('web').forRequest().terminate();
    if (outcome === 'committed') return response.serviceUnavailable(deletionCommitted);
    return serialize({ ok: true, signedOut: true });
  }
}
