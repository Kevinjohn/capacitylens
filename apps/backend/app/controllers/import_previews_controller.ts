import { inject } from '@adonisjs/core';
import type { HttpContext } from '@adonisjs/core/http';
import { CurrentActorService } from '#services/auth/current_actor_service';
import { PasswordConfirmationService } from '#services/auth/password_confirmation_service';
import { previewCompanyImport, readRequestDocument } from '#services/company_import';
import { previewImportValidator } from '#validators/import';

/** Previews what importing a company export would change. */
@inject()
export default class ImportPreviewsController {
  #currentActor: CurrentActorService;
  #passwordConfirmationRules: PasswordConfirmationService;

  constructor(
    currentActor: CurrentActorService,
    passwordConfirmationRules: PasswordConfirmationService
  ) {
    this.#currentActor = currentActor;
    this.#passwordConfirmationRules = passwordConfirmationRules;
  }

  async store({ auth, request, serialize }: HttpContext) {
    const body = await request.validateUsing(previewImportValidator, {
      data: request.body(),
    });
    const companyId = body.companyId;
    // The preview names why a document is refused, so the browser never validates it itself.
    const document = readRequestDocument(body.document);
    const result = await this.#currentActor.withActor(auth, async (_actor, trx) => {
      await this.#passwordConfirmationRules.requirePasswordConfirmationActor(
        companyId,
        trx,
        'import'
      );
      return previewCompanyImport(trx, companyId, document);
    });
    return serialize(result);
  }
}
