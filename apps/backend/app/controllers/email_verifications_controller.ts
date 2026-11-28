import type { HttpContext } from '@adonisjs/core/http'
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main'
import {
  E_ACCOUNT_KIT_INVALID_TOKEN,
  isCommittedFailure,
} from '@kevinjohn/adonisjs-account-kit/errors'
import InvalidLinkException from '#exceptions/invalid_link_exception'
import VerificationCommittedException from '#exceptions/verification_committed_exception'
import {
  completeVerificationValidator,
  inspectVerificationValidator,
} from '#validators/verification'

/** Address confirmation for a signed-in identity, reachable before admission: spending the link. */
export default class EmailVerificationsController {
  /** Reports whether a confirmation link is still usable without spending it. */
  async show({ request, serialize }: HttpContext) {
    const body = await request.validateUsing(inspectVerificationValidator, {
      data: request.body(),
    })
    return serialize({
      valid: await accountKit.emailVerification.inspect({ token: body.token }),
    })
  }

  /**
   * Spends the link, confirms the address and sets the chosen password. Holding the link already
   * proves the mailbox, which could reset the password anyway.
   */
  async update({ request, serialize }: HttpContext) {
    const body = await request.validateUsing(completeVerificationValidator, {
      data: request.body(),
    })
    try {
      await accountKit.emailVerification.complete({
        token: body.token,
        password: body.password,
      })
      return serialize({ result: 'verified' })
    } catch (error) {
      if (error instanceof E_ACCOUNT_KIT_INVALID_TOKEN) {
        throw new InvalidLinkException()
      }
      if (isCommittedFailure(error)) {
        throw new VerificationCommittedException()
      }
      throw error
    }
  }
}
