import type { HttpContext } from '@adonisjs/core/http'
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main'
import {
  E_ACCOUNT_KIT_IDENTITY_NOT_CONFIRMED,
  isCommittedFailure,
} from '@kevinjohn/adonisjs-account-kit/errors'
import { credentialUpdateCommitted } from '#exceptions/credential_answers'
import { changePasswordValidator } from '#validators/credential'

/** The signed-in identity's password. */
export default class PasswordController {
  /** Changes the password and ends every sign-in, this one included. */
  async update({ auth, request, response, serialize }: HttpContext) {
    const body = await request.validateUsing(changePasswordValidator, {
      data: request.body(),
    })
    const account = auth.use('web').getUserOrFail()
    let outcome: 'changed' | 'committed' = 'changed'
    try {
      await accountKit.emailPasswordManagement.changePassword({
        actorId: account.id,
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
      })
    } catch (error) {
      // Does work: a committed change is recorded before the session ends.
      if (error instanceof E_ACCOUNT_KIT_IDENTITY_NOT_CONFIRMED) {
        return response.forbidden({
          error: 'Current password is incorrect.',
          code: 'E_CURRENT_PASSWORD_INCORRECT',
        })
      }
      if (!isCommittedFailure(error)) throw error
      outcome = 'committed'
    }
    await auth.use('web').forRequest().terminate()
    if (outcome === 'committed') return response.serviceUnavailable(credentialUpdateCommitted)
    return serialize({ ok: true, signedOut: true })
  }
}
