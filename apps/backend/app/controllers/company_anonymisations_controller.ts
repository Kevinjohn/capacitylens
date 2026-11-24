import { inject } from '@adonisjs/core';
import type { HttpContext } from '@adonisjs/core/http';
import { CurrentActorService } from '#services/auth/current_actor_service';
import { anonymiseResources } from '#services/anonymise';
import { PasswordConfirmationService } from '#services/auth/password_confirmation_service';
import passwordConfirmations from '@kevinjohn/adonisjs-confirm-action-with-password/services/main';
import { anonymiseCompanyValidator } from '#validators/anonymise';

/** Anonymises every person in the company after a password confirmation. */
@inject()
export default class CompanyAnonymisationsController {
  #currentActor: CurrentActorService;
  #passwordConfirmationRules: PasswordConfirmationService;

  constructor(
    currentActor: CurrentActorService,
    passwordConfirmationRules: PasswordConfirmationService
  ) {
    this.#currentActor = currentActor;
    this.#passwordConfirmationRules = passwordConfirmationRules;
  }

  async store({ auth, params, request, response }: HttpContext) {
    const body = await request.validateUsing(anonymiseCompanyValidator, {
      data: request.body(),
    });
    const { companyId } = params;
    await this.#currentActor.withActor(auth, async (_actor, trx) => {
      const actor = await this.#passwordConfirmationRules.requirePasswordConfirmationActor(
        companyId,
        trx,
        'anonymise'
      );
      await passwordConfirmations.consume(this.#currentActor.requireKitContext(trx), {
        confirmationId: body.confirmationId,
        action: 'anonymise',
        scope: companyId,
        intent: {},
      });
      await anonymiseResources(trx, companyId, actor.userId);
    });
    return response.noContent();
  }
}
