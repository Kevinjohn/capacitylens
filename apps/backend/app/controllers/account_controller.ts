import type { HttpContext } from '@adonisjs/core/http'
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main'
import passwordConfirmations from '@kevinjohn/adonisjs-confirm-action-with-password/services/main'
import {
  E_ACCOUNT_KIT_IDENTITY_NOT_CONFIRMED,
  isCommittedFailure,
} from '@kevinjohn/adonisjs-account-kit/errors'
import AccountDeletionCommittedException from '#exceptions/account_deletion_committed_exception'
import CurrentPasswordIncorrectException from '#exceptions/current_password_incorrect_exception'
import { deleteAccountValidator } from '#validators/credential'

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
  async destroy({ auth, request, serialize }: HttpContext) {
    const body = await request.validateUsing(deleteAccountValidator, {
      data: request.body(),
    })
    const input = await auth.use('web').current()
    const confirmation = { action: 'delete-account', scope: String(input.userId), intent: {} }
    const { confirmationId } = await passwordConfirmations.confirmPassword(input, {
      ...confirmation,
      password: body.currentPassword,
    })
    await passwordConfirmations.withConfirmation(
      input,
      { ...confirmation, confirmationId },
      async () => {}
    )
    try {
      await accountKit.accountData.delete({
        actorId: input.userId,
        currentPassword: body.currentPassword,
      })
    } catch (error) {
      if (error instanceof E_ACCOUNT_KIT_IDENTITY_NOT_CONFIRMED) {
        throw new CurrentPasswordIncorrectException()
      }
      if (!isCommittedFailure(error)) throw error
      // Does work: a committed deletion still ends the session before reporting 503.
      await auth.use('web').forRequest().terminate()
      throw new AccountDeletionCommittedException()
    }
    await auth.use('web').forRequest().terminate()
    return serialize({ ok: true, signedOut: true })
  }
}
