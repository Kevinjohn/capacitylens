import { inject } from '@adonisjs/core'
// The wire names are `POST /api/v1/auth/password-confirmation`, `confirmationId`,
// `E_PASSWORD_CONFIRMATION_REQUIRED` and `E_PASSWORD_CONFIRMATION_DENIED`.
//
// Confirmations are pruned globally after successful issuance, outside every transaction; a pruning
// failure cannot fail the issuance response.

import type { HttpContext } from '@adonisjs/core/http'
import passwordConfirmations from '@kevinjohn/adonisjs-confirm-action-with-password/services/main'
import { PasswordConfirmationService } from '#services/auth/password_confirmation_service'
import { CurrentActorService } from '#services/auth/current_actor_service'
import { confirmPasswordValidator } from '#validators/password_confirmation'
import { CompanyImportService } from '#services/company_import_service'

@inject()
export default class PasswordConfirmationsController {
  #passwordConfirmationRules: PasswordConfirmationService
  #currentActor: CurrentActorService
  #companyImports: CompanyImportService

  constructor(
    passwordConfirmationRules: PasswordConfirmationService,
    currentActor: CurrentActorService,
    companyImports: CompanyImportService
  ) {
    this.#passwordConfirmationRules = passwordConfirmationRules
    this.#currentActor = currentActor
    this.#companyImports = companyImports
  }

  async store({ auth, request, response, logger, serialize }: HttpContext) {
    const body = await request.validateUsing(confirmPasswordValidator, {
      data: request.body(),
    })
    let intent: unknown = body.intent
    if (body.action === 'import') {
      const document = this.#companyImports.parseRequestDocument(body.intent.document)
      if (!document) return response.badRequest({ error: 'Invalid password confirmation.' })
      intent = { baseRevision: body.intent.baseRevision, document }
    }
    await this.#currentActor.withActor(auth, async (_actor, trx) =>
      this.#passwordConfirmationRules.requirePasswordConfirmationActor(
        body.companyId,
        trx,
        body.action
      )
    )
    const { confirmationId } = await passwordConfirmations.confirmPassword(
      await auth.use('web').current(),
      {
        action: body.action,
        scope: body.companyId,
        intent,
        password: body.password,
      }
    )
    try {
      await passwordConfirmations.prune()
    } catch (error) {
      // Does work: pruning is best effort, so its failure is logged and the confirmation stands.
      logger.error(
        { event: 'password_confirmation.prune', err: error },
        'Password confirmation pruning failed'
      )
    }
    return serialize({ confirmationId })
  }
}
