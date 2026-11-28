import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main'
import { E_ACCOUNT_KIT_THROTTLED } from '@kevinjohn/adonisjs-account-kit/errors'
import { requestResetValidator } from '#validators/password_reset_request'
import { MailDeliveryService } from '#services/mail_delivery_service'

/** Requests a password reset link by email. */
@inject()
export default class PasswordResetRequestsController {
  #mailDelivery: MailDeliveryService

  constructor(mailDelivery: MailDeliveryService) {
    this.#mailDelivery = mailDelivery
  }

  async store({ request, response, logger, serialize }: HttpContext) {
    const { email } = await request.validateUsing(requestResetValidator, {
      data: request.body(),
    })
    if (!this.#mailDelivery.isMailConfigured()) {
      return response.notFound({ error: 'Password recovery is unavailable.' })
    }
    try {
      await accountKit.passwordReset.request({ email, clientKey: request.ip() })
    } catch (error) {
      if (error instanceof E_ACCOUNT_KIT_THROTTLED) throw error
      // Public recovery does not disclose recipient or delivery state.
      logger.error({ err: error }, 'Password recovery request failed')
    }
    return serialize({ ok: true })
  }
}
