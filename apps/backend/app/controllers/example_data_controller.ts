import { inject } from '@adonisjs/core';
import type { HttpContext } from '@adonisjs/core/http';
import { CurrentActorService } from '#services/auth/current_actor_service';
import { addExampleData } from '#services/example_data';
import { AuthorizationService } from '#services/auth/authorization_service';

@inject()
export default class ExampleDataController {
  #currentActor: CurrentActorService;
  #authorization: AuthorizationService;

  constructor(currentActor: CurrentActorService, authorization: AuthorizationService) {
    this.#currentActor = currentActor;
    this.#authorization = authorization;
  }

  async store({ auth, params, response, logger, serialize }: HttpContext) {
    const companyId = params.companyId;
    const added = await this.#currentActor.withActor(auth, async (_actor, trx) => {
      const actor = await this.#authorization.assertCompanyPermission(
        companyId,
        'members:manage',
        trx
      );
      return addExampleData(trx, companyId, actor.actorId);
    });
    try {
      logger.info({ companyId, added }, 'Example data committed');
    } catch {
      // The audit and data are already committed; logging is diagnostic only.
    }
    return response.created(await serialize({ added }));
  }
}
