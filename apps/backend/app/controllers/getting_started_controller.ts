import { inject } from '@adonisjs/core';
import { isOwnerOrAdmin } from '@capacitylens/shared/domain/access';
import type { HttpContext } from '@adonisjs/core/http';
import { CurrentActorService } from '#services/auth/current_actor_service';
import { AuthorizationService } from '#services/auth/authorization_service';
import { IdentityAuthorizationException } from '#exceptions/identity_authorization_exception';
import { updateGettingStartedValidator } from '#validators/getting_started';
import { GettingStartedService } from '#services/getting_started_service';

@inject()
export default class GettingStartedController {
  #currentActor: CurrentActorService;
  #authorization: AuthorizationService;
  #gettingStarted: GettingStartedService;

  constructor(
    currentActor: CurrentActorService,
    authorization: AuthorizationService,
    gettingStarted: GettingStartedService
  ) {
    this.#currentActor = currentActor;
    this.#authorization = authorization;
    this.#gettingStarted = gettingStarted;
  }

  async show({ auth, params, serialize }: HttpContext) {
    return serialize(
      await this.#currentActor.withActor(auth, async (_actor, trx) => {
        await this.#authorization.assertCompanyPermission(params.companyId, 'planning:read', trx);
        return {
          dismissed: await this.#gettingStarted.isGettingStartedDismissed(trx, params.companyId),
          steps: await this.#gettingStarted.readGettingStartedSteps(trx, params.companyId),
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
        throw new IdentityAuthorizationException();
      }
      await this.#gettingStarted.dismissGettingStarted(trx, params.companyId, now);
    });
    return serialize({ dismissed: true });
  }
}
