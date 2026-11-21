import type { HttpContext } from '@adonisjs/core/http';
import { withActor } from '#services/auth/current_actor';
import { parseFirstCompanyInput, isFirstCompanySetupRequired } from '#services/first_company_setup';
import { createInitialCompany } from '#services/initial_company_defaults';
import {
  firstCompanySetupMessage,
  createFirstCompanyValidator,
} from '#validators/first_company_setup';

/**
 * Establishes company access only for the sole confirmed, admitted user on an empty
 * installation. The Kit's account transaction serialises competing setups.
 */
export default class FirstCompanySetupController {
  async store(ctx: HttpContext) {
    const body = await ctx.request.validateUsing(createFirstCompanyValidator, {
      data: ctx.request.body(),
    });
    const input = parseFirstCompanyInput(body);
    if (input === null) {
      return ctx.response.badRequest({ error: firstCompanySetupMessage, code: 'VALIDATION_ERROR' });
    }
    const result = await withActor(ctx, async (actor, trx) => {
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
      return ctx.response.conflict({
        error: 'First company setup is unavailable for this installation.',
        code: 'COMPANY_SETUP_UNAVAILABLE',
      });
    }
    return ctx.response.created({ companyId: result.companyId });
  }
}
