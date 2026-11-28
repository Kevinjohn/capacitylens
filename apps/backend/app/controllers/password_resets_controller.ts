import type { HttpContext } from '@adonisjs/core/http'
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main'
import {
  E_ACCOUNT_KIT_INVALID_TOKEN,
  isCommittedFailure,
} from '@kevinjohn/adonisjs-account-kit/errors'
import CredentialUpdateCommittedException from '#exceptions/credential_update_committed_exception'
import InvalidLinkException from '#exceptions/invalid_link_exception'
import { inspectResetValidator, resetPasswordValidator } from '#validators/credential'

/** A password reset link: whether it is still usable, and spending it to set a new password. */
export default class PasswordResetsController {
  /** Reports whether a reset link is still usable without spending it. */
  async show({ request, serialize }: HttpContext) {
    const body = await request.validateUsing(inspectResetValidator, {
      data: request.body(),
    })
    return serialize({
      valid: await accountKit.passwordReset.inspect({ token: body.token }),
    })
  }

  /** Every sign-in, including any on this device, ends with the old password. */
  async update({ request, serialize }: HttpContext) {
    const body = await request.validateUsing(resetPasswordValidator, {
      data: request.body(),
    })
    try {
      await accountKit.passwordReset.reset({ token: body.token, password: body.newPassword })
      return serialize({ ok: true })
    } catch (error) {
      if (error instanceof E_ACCOUNT_KIT_INVALID_TOKEN) {
        throw new InvalidLinkException()
      }
      if (isCommittedFailure(error)) throw new CredentialUpdateCommittedException()
      throw error
    }
  }
}
