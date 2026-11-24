import { inject } from '@adonisjs/core';
import { isOwnerOrAdmin } from '@capacitylens/shared/domain/access';
import type { HttpContext } from '@adonisjs/core/http';
import { CurrentActorService } from '#services/auth/current_actor_service';
import { AuthorizationService } from '#services/auth/authorization_service';
import { IdentityAuthorizationException } from '#exceptions/identity_authorization_exception';
import {
  dismissGettingStarted,
  isGettingStartedDismissed,
  readGettingStartedSteps,
} from '#services/getting_started';
import { updateGettingStartedValidator } from '#validators/getting_started';

@inject()
export default class GettingStartedController {
  #currentActor: CurrentActorService;
  #authorization: AuthorizationService;

  constructor(currentActor: CurrentActorService, authorization: AuthorizationService) {
    this.#currentActor = currentActor;
    this.#authorization = authorization;
  }

  async show({ auth, params, serialize }: HttpContext) {
    return serialize(
      await this.#currentActor.withActor(auth, async (_actor, trx) => {
        await this.#authorization.assertCompanyPermission(params.companyId, 'planning:read', trx);
        return {
          dismissed: await isGettingStartedDismissed(trx, params.companyId),
          steps: await readGettingStartedSteps(trx, params.companyId),
        };
      })
    );
  }

  async update({ auth, params, request, serialize }: HttpContext) {
    await request.validateUsing(updateGettingStartedValidator, { data: request.body() });
    const now = new Date().toISOString();
    await this.#currentActor.withActor(auth, async (_actor, trx) => {
      const { role } = await this.#authorization.assertCompanyPermission(
        params.companyId,
        'planning:write',
        trx
      );
      if (!isOwnerOrAdmin(role)) {
        throw new IdentityAuthorizationException('Forbidden.');
      }
      await dismissGettingStarted(trx, params.companyId, now);
    });
    return serialize({ dismissed: true });
  }
}
