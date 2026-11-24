import { inject } from '@adonisjs/core';
import type { HttpContext } from '@adonisjs/core/http';
import { CurrentActorService } from '#services/auth/current_actor_service';
import { PasswordConfirmationService } from '#services/auth/password_confirmation_service';
import passwordConfirmations from '@kevinjohn/adonisjs-confirm-action-with-password/services/main';
import { anonymiseCompanyValidator } from '#validators/anonymise';
import { AnonymisationService } from '#services/anonymisation_service';

/** Anonymises every person in the company after a password confirmation. */
@inject()
export default class CompanyAnonymisationsController {
  #currentActor: CurrentActorService;
  #passwordConfirmationRules: PasswordConfirmationService;
  #anonymisations: AnonymisationService;

  constructor(
    currentActor: CurrentActorService,
    passwordConfirmationRules: PasswordConfirmationService,
    anonymisations: AnonymisationService
  ) {
    this.#currentActor = currentActor;
    this.#passwordConfirmationRules = passwordConfirmationRules;
    this.#anonymisations = anonymisations;
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
      await this.#anonymisations.anonymiseResources(trx, companyId, actor.userId);
    });
    return response.noContent();
  }
}
