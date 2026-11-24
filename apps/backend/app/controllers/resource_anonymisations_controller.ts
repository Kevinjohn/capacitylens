import { inject } from '@adonisjs/core';
import type { HttpContext } from '@adonisjs/core/http';
import { CurrentActorService } from '#services/auth/current_actor_service';
import { anonymiseResources } from '#services/anonymise';
import { anonymiseResourceValidator } from '#validators/anonymise';
import { AuthorizationService } from '#services/auth/authorization_service';

/** Anonymises one person. */
@inject()
export default class ResourceAnonymisationsController {
  #currentActor: CurrentActorService;
  #authorization: AuthorizationService;

  constructor(currentActor: CurrentActorService, authorization: AuthorizationService) {
    this.#currentActor = currentActor;
    this.#authorization = authorization;
  }

  async store({ auth, params, request, response }: HttpContext) {
    await request.validateUsing(anonymiseResourceValidator, { data: request.body() });
    const { companyId, id } = params;
    const applied = await this.#currentActor.withActor(auth, async (actor, trx) => {
      if (actor.masqueradeContext?.isMasquerading) return 'forbidden';
      await this.#authorization.assertCompanyPermission(companyId, 'resources:anonymise', trx);
      return anonymiseResources(trx, companyId, actor.userId, id);
    });
    if (applied === 'forbidden') return response.forbidden({ error: 'Forbidden.' });
    if (!applied) return response.notFound({ error: 'Not found.' });
    return response.noContent();
  }
}
