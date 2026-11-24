import { inject } from '@adonisjs/core';
import type { HttpContext } from '@adonisjs/core/http';
import { CurrentActorService } from '#services/auth/current_actor_service';
import { ValidationRefusalException } from '#exceptions/validation_refusal_exception';
import {
  firstCompanySetupMessage,
  createFirstCompanyValidator,
} from '#validators/first_company_setup';
import { FirstCompanySetupService } from '#services/first_company_setup_service';
import { InitialCompanyDefaultsService } from '#services/initial_company_defaults_service';

/**
 * Establishes company access only for the sole confirmed, admitted user on an empty
 * installation. The Kit's account transaction serialises competing setups.
 */
@inject()
export default class FirstCompanySetupController {
  #currentActor: CurrentActorService;
  #firstCompanySetup: FirstCompanySetupService;
  #initialCompanyDefaults: InitialCompanyDefaultsService;

  constructor(
    currentActor: CurrentActorService,
    firstCompanySetup: FirstCompanySetupService,
    initialCompanyDefaults: InitialCompanyDefaultsService
  ) {
    this.#currentActor = currentActor;
    this.#firstCompanySetup = firstCompanySetup;
    this.#initialCompanyDefaults = initialCompanyDefaults;
  }

  async store({ auth, request, response, serialize }: HttpContext) {
    const body = await request.validateUsing(createFirstCompanyValidator, {
      data: request.body(),
    });
    const input = this.#firstCompanySetup.parseFirstCompanyInput(body);
    if (input === null) {
      throw new ValidationRefusalException(firstCompanySetupMessage);
    }
    const result = await this.#currentActor.withActor(auth, async (actor, trx) => {
      if (!(await this.#firstCompanySetup.isFirstCompanySetupRequired(actor.userId, trx))) {
        return null;
      }
      return this.#initialCompanyDefaults.createInitialCompany(trx, {
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
