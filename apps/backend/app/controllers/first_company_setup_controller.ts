import type { HttpContext } from '@adonisjs/core/http';
import { withActor } from '#services/auth/current_actor';
import { parseFirstCompanyInput, requiresFirstCompanySetup } from '#services/first_company_setup';
import { createInitialCompany } from '#services/initial_company_defaults';
import { MAX_NAME_LENGTH } from '@capacitylens/shared/lib/strings';

/**
 * Establishes company access only for the sole confirmed, admitted principal on an empty
 * installation. The Kit's account transaction serialises competing setups.
 */
export default class FirstCompanySetupController {
  async store(ctx: HttpContext) {
    const body: unknown = ctx.request.body();
    const input = parseFirstCompanyInput(body);
    if (input === null) {
      return ctx.response.badRequest({
        error: `Enter a company name of up to ${MAX_NAME_LENGTH} characters without unsupported characters, a Sunday or Monday week start, and a supported time zone.`,
        code: 'VALIDATION_ERROR',
      });
    }
    const result = await withActor(ctx, async (actor, trx) => {
      if (!(await requiresFirstCompanySetup(actor.userId, trx))) return null;
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
    return ctx.response.created({ accountId: result.accountId });
  }
}
