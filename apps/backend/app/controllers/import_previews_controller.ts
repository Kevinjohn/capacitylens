import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { CurrentActorService } from '#services/auth/current_actor_service'
import { PasswordConfirmationService } from '#services/auth/password_confirmation_service'
import { previewImportValidator } from '#validators/import'
import { CompanyImportService } from '#services/company_import_service'

/** Previews what importing a company export would change. */
@inject()
export default class ImportPreviewsController {
  #currentActor: CurrentActorService
  #passwordConfirmationRules: PasswordConfirmationService
  #companyImports: CompanyImportService

  constructor(
    currentActor: CurrentActorService,
    passwordConfirmationRules: PasswordConfirmationService,
    companyImports: CompanyImportService
  ) {
    this.#currentActor = currentActor
    this.#passwordConfirmationRules = passwordConfirmationRules
    this.#companyImports = companyImports
  }

  async store({ auth, request, serialize }: HttpContext) {
    const body = await request.validateUsing(previewImportValidator)
    const companyId = body.companyId
    // The preview names why a document is refused, so the browser never validates it itself.
    const document = this.#companyImports.readRequestDocument(body.document)
    const result = await this.#currentActor.withActor(auth, async (_actor, trx) => {
      await this.#passwordConfirmationRules.requirePasswordConfirmationActor(
        companyId,
        trx,
        'import'
      )
      return this.#companyImports.previewCompanyImport(trx, companyId, document)
    })
    return serialize(result)
  }
}
