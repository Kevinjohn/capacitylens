import { inject } from '@adonisjs/core';
import type { HttpContext } from '@adonisjs/core/http';
import { CurrentActorService } from '#services/auth/current_actor_service';
import { parseFirstCompanyInput, isFirstCompanySetupRequired } from '#services/first_company_setup';
import { createInitialCompany } from '#services/initial_company_defaults';
import { ValidationRefusalException } from '#exceptions/validation_refusal_exception';
import {
  firstCompanySetupMessage,
  createFirstCompanyValidator,
} from '#validators/first_company_setup';

/**
 * Establishes company access only for the sole confirmed, admitted user on an empty
 * installation. The Kit's account transaction serialises competing setups.
 */
@inject()
export default class FirstCompanySetupController {
  #currentActor: CurrentActorService;

  constructor(currentActor: CurrentActorService) {
    this.#currentActor = currentActor;
  }

  async store({ auth, request, response, serialize }: HttpContext) {
    const body = await request.validateUsing(createFirstCompanyValidator, {
      data: request.body(),
    });
    const input = parseFirstCompanyInput(body);
    if (input === null) {
      throw new ValidationRefusalException(firstCompanySetupMessage);
    }
    const result = await this.#currentActor.withActor(auth, async (actor, trx) => {
      if (!(await isFirstCompanySetupRequired(actor.userId, trx))) return null;
      return createInitialCompany(trx, {
        name: input.name,
        ownerId: actor.userId,
        actorId: actor.userId,
        weekStartsOn: input.weekStartsOn,
        timezone: input.timeZone,
      });
    });
    if (!result) {
      return response.conflict({
        error: 'First company setup is unavailable for this installation.',
        code: 'COMPANY_SETUP_UNAVAILABLE',
      });
    }
    return response.created(await serialize({ companyId: result.companyId }));
  }
}
