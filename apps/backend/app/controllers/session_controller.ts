import { inject } from '@adonisjs/core'
import { AdmissionMembershipService } from '#services/membership/admission_membership_service'
import type { HttpContext } from '@adonisjs/core/http'
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main'
import {
  E_INVALID_CREDENTIALS,
  E_ACCOUNT_KIT_INVALID_SESSION,
} from '@kevinjohn/adonisjs-account-kit/errors'
import type { CurrentAccountInput } from '@kevinjohn/adonisjs-account-kit/types'
import InvalidCredentialsException from '#exceptions/invalid_credentials_exception'
import SignInRequiredException from '#exceptions/sign_in_required_exception'
import { PasswordSignInService } from '#services/auth/password_sign_in_service'
import { buildUserProjection } from '#services/auth/user_projection'
import { CurrentActorService } from '#services/auth/current_actor_service'
import { signInValidator } from '#validators/auth'
import { requestData } from '#validators/request_rules'
import { FirstCompanySetupService } from '#services/first_company_setup_service'
import { InstallationCompanyService } from '#services/installation_company_service'
import { MailDeliveryService } from '#services/mail_delivery_service'

/** The caller's sign-in: who is signed in, signing in with a password, and signing out. */
@inject()
export default class SessionController {
  #passwordSignIn: PasswordSignInService
  #currentActor: CurrentActorService
  #admissionMemberships: AdmissionMembershipService
  #firstCompanySetup: FirstCompanySetupService
  #installationCompany: InstallationCompanyService
  #mailDelivery: MailDeliveryService

  constructor(
    admissionMemberships: AdmissionMembershipService,
    passwordSignIn: PasswordSignInService,
    currentActor: CurrentActorService,
    firstCompanySetup: FirstCompanySetupService,
    installationCompany: InstallationCompanyService,
    mailDelivery: MailDeliveryService
  ) {
    this.#admissionMemberships = admissionMemberships
    this.#passwordSignIn = passwordSignIn
    this.#currentActor = currentActor
    this.#firstCompanySetup = firstCompanySetup
    this.#installationCompany = installationCompany
    this.#mailDelivery = mailDelivery
  }

  /**
   * The signed-in identity and what it may reach: a confirmed address, admission, company setup
   * and membership decide between the limited screens and the schedule.
   */
  async show({ auth, serialize }: HttpContext) {
    try {
      return serialize(
        await this.#currentActor.withActor(
          auth,
          async (actor, trx) => {
            const admission = await this.#currentActor.requireAdmissionDecision(actor.userId, trx)
            const admitted = actor.emailVerified && admission.admitted
            return {
              user: buildUserProjection(actor),
              emailVerified: actor.emailVerified,
              admission,
              companySetupRequired:
                admitted &&
                (await this.#firstCompanySetup.isFirstCompanySetupRequired(actor.userId, trx)),
              // Admitted but not yet a member: the person completes their membership explicitly.
              membershipRequired:
                admitted &&
                (await this.#admissionMemberships.isMembershipRequired(actor.userId, trx)),
            }
          },
          { limited: true }
        )
      )
    } catch (error) {
      // Does work: a missing session reads whether any identity exists for the 401 body.
      if (!(error instanceof E_ACCOUNT_KIT_INVALID_SESSION)) throw error
      const hasUsers = await this.#installationCompany.hasAnyIdentity()
      throw new SignInRequiredException({
        passwordResetEmail: this.#mailDelivery.isMailConfigured(),
        needsSetup: !hasUsers,
      })
    }
  }

  async store({ auth, request, logger, serialize }: HttpContext) {
    const body = await request.validateUsing(signInValidator, {
      data: requestData(request, request.body()),
    })
    const { email } = body
    try {
      const user = await this.#passwordSignIn.signInWithPassword(auth, logger, {
        email,
        password: body.password,
        clientAddress: request.ip(),
        userAgent: body.headers['user-agent'],
      })
      return serialize({ user })
    } catch (error) {
      if (error instanceof E_INVALID_CREDENTIALS) {
        throw new InvalidCredentialsException()
      }
      throw error
    }
  }

  /** Ends this sign-in while leaving the identity-wide view active in its other sessions. */
  async destroy({ auth, session, serialize }: HttpContext) {
    const guard = auth.use('web')
    const request = guard.forRequest()
    let current: CurrentAccountInput | undefined
    try {
      current = await guard.current()
    } catch (error) {
      // Does work: signing out without a session is a normal outcome, not a refusal.
      if (!(error instanceof E_ACCOUNT_KIT_INVALID_SESSION)) throw error
      // Does work: an idle-expired sign-in fails `current` but still names its own registry row.
      const userId: unknown = session.get(guard.sessionKeyName)
      const sessionHandle = request.strategy === 'session' ? request.previousHandle?.() : undefined
      if ((typeof userId === 'string' || typeof userId === 'number') && sessionHandle) {
        current = { userId, sessionHandle }
      }
    }
    await accountKit.authentication.logout(request, undefined, current)
    return serialize({ ok: true })
  }
}
