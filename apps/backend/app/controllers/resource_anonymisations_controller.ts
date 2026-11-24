import { inject } from '@adonisjs/core';
import type { HttpContext } from '@adonisjs/core/http';
import { CurrentActorService } from '#services/auth/current_actor_service';
import { anonymiseResourceValidator } from '#validators/anonymise';
import { AuthorizationService } from '#services/auth/authorization_service';
import { AnonymisationService } from '#services/anonymisation_service';

/** Anonymises one person. */
@inject()
export default class ResourceAnonymisationsController {
  #currentActor: CurrentActorService;
  #authorization: AuthorizationService;
  #anonymisations: AnonymisationService;

  constructor(
    currentActor: CurrentActorService,
    authorization: AuthorizationService,
    anonymisations: AnonymisationService
  ) {
    this.#currentActor = currentActor;
    this.#authorization = authorization;
    this.#anonymisations = anonymisations;
  }

  async store({ auth, params, request, response }: HttpContext) {
    await request.validateUsing(anonymiseResourceValidator, { data: request.body() });
    const { companyId, id } = params;
    const applied = await this.#currentActor.withActor(auth, async (actor, trx) => {
      if (actor.masqueradeContext?.isMasquerading) return 'forbidden';
      await this.#authorization.assertCompanyPermission(companyId, 'resources:anonymise', trx);
      return this.#anonymisations.anonymiseResources(trx, companyId, actor.userId, id);
    });
    if (applied === 'forbidden') return response.forbidden({ error: 'Forbidden.' });
    if (!applied) return response.notFound({ error: 'Not found.' });
    return response.noContent();
  }
}
