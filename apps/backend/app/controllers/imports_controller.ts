import { inject } from '@adonisjs/core';
import type { HttpContext } from '@adonisjs/core/http';
import { CurrentActorService } from '#services/auth/current_actor_service';
import { PasswordConfirmationService } from '#services/auth/password_confirmation_service';
import passwordConfirmations from '@kevinjohn/adonisjs-confirm-action-with-password/services/main';
import { applyCompanyImport, parseRequestDocument } from '#services/company_import';
import { applyImportValidator } from '#validators/import';

/** Imports a company export after a password confirmation. */
@inject()
export default class ImportsController {
  #currentActor: CurrentActorService;
  #passwordConfirmationRules: PasswordConfirmationService;

  constructor(
    currentActor: CurrentActorService,
    passwordConfirmationRules: PasswordConfirmationService
  ) {
    this.#currentActor = currentActor;
    this.#passwordConfirmationRules = passwordConfirmationRules;
  }

  async store({ auth, request, response, serialize }: HttpContext) {
    const body = await request.validateUsing(applyImportValidator, {
      data: request.body(),
    });
    const { companyId, baseRevision, confirmationId = '' } = body;
    const document = parseRequestDocument(body.document);
    if (!document) return response.badRequest({ error: 'Invalid beta import request.' });
    const result = await this.#currentActor.withActor(auth, async (_actor, trx) => {
      const actor = await this.#passwordConfirmationRules.requirePasswordConfirmationActor(
        companyId,
        trx,
        'import'
      );
      await passwordConfirmations.consume(this.#currentActor.requireKitContext(trx), {
        confirmationId,
        action: 'import',
        scope: companyId,
        intent: { baseRevision, document },
      });
      return applyCompanyImport(trx, companyId, document, baseRevision, actor.userId);
    });
    return serialize(result);
  }
}
