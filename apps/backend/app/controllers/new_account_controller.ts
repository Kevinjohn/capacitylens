import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main'
import {
  E_ACCOUNT_KIT_REGISTRATION_EMAIL_ALREADY_REGISTERED,
  isCommittedFailure,
} from '@kevinjohn/adonisjs-account-kit/errors'
import capacitylens from '#config/capacitylens'
import EmailInUseException from '#exceptions/email_in_use_exception'
import FirstCompanyPendingException from '#exceptions/first_company_pending_exception'
import SignUpClosedException from '#exceptions/sign_up_closed_exception'
import { PasswordSignInService } from '#services/auth/password_sign_in_service'
import { signUpValidator } from '#validators/auth_requests'
import { requestData } from '#validators/request_rules'
import { InstallationCompanyService } from '#services/installation_company_service'

/** Open sign-up of a new account. */
@inject()
export default class NewAccountController {
  #passwordSignIn: PasswordSignInService
  #installationCompany: InstallationCompanyService

  constructor(
    passwordSignIn: PasswordSignInService,
    installationCompany: InstallationCompanyService
  ) {
    this.#passwordSignIn = passwordSignIn
    this.#installationCompany = installationCompany
  }

  /**
   * Open sign-up, when the operator enables it, creates a limited identity that still needs
   * a confirmed address and admission. The first identity always comes from the bootstrap invitation.
   */
  async store({ auth, request, response, logger, serialize }: HttpContext) {
    const body = await request.validateUsing(signUpValidator, {
      data: requestData(request, request.body()),
    })
    const { email, name } = body
    if (!capacitylens.allowOpenSignUp || (await this.#installationCompany.hasNoCompany())) {
      return response.forbidden({ error: 'Sign-up is closed.', code: 'E_SIGN_UP_CLOSED' })
    }
    try {
      await accountKit.registration.register({
        email,
        password: body.password,
        registrationData: { name },
      })
    } catch (error) {
      if (error instanceof FirstCompanyPendingException) {
        throw new SignUpClosedException()
      }
      if (error instanceof E_ACCOUNT_KIT_REGISTRATION_EMAIL_ALREADY_REGISTERED) {
        throw new EmailInUseException()
      }
      // The account exists; only the confirmation email may be missing, and it can be resent.
      if (!isCommittedFailure(error)) throw error
      logger.warn({ code: 'SIGN_UP_FOLLOW_UP_FAILED' }, 'Sign-up follow-up failed')
    }
    try {
      return response.created(
        await serialize({
          user: await this.#passwordSignIn.signInWithPassword(auth, logger, {
            email,
            password: body.password,
            clientAddress: request.ip(),
            userAgent: body.headers['user-agent'],
          }),
        })
      )
    } catch (error) {
      // Does work: the account exists, so a failed sign-in is logged and answered as sign-in
      // required.
      logger.warn({ err: error }, 'Sign-in after registration failed')
      return response.accepted(await serialize({ accountCreated: true, signInRequired: true }))
    }
  }
}
