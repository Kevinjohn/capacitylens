import type { HttpContext } from '@adonisjs/core/http'
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main'
import {
  E_ACCOUNT_KIT_IDENTITY_NOT_CONFIRMED,
  isCommittedFailure,
} from '@kevinjohn/adonisjs-account-kit/errors'
import CredentialUpdateCommittedException from '#exceptions/credential_update_committed_exception'
import CurrentPasswordIncorrectException from '#exceptions/current_password_incorrect_exception'
import { changePasswordValidator } from '#validators/password'

/** The signed-in identity's password. */
export default class PasswordController {
  /** Changes the password and ends every sign-in, this one included. */
  async update({ auth, request, serialize }: HttpContext) {
    const body = await request.validateUsing(changePasswordValidator, {
      data: request.body(),
    })
    const account = auth.use('web').getUserOrFail()
    try {
      await accountKit.emailPasswordManagement.changePassword({
        actorId: account.id,
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
      })
    } catch (error) {
      if (error instanceof E_ACCOUNT_KIT_IDENTITY_NOT_CONFIRMED) {
        throw new CurrentPasswordIncorrectException()
      }
      if (!isCommittedFailure(error)) throw error
      // Does work: a committed change still ends the session before reporting 503.
      await auth.use('web').forRequest().terminate()
      throw new CredentialUpdateCommittedException()
    }
    await auth.use('web').forRequest().terminate()
    return serialize({ ok: true, signedOut: true })
  }
}
