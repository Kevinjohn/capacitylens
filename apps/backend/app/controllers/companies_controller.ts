import type { HttpContext } from '@adonisjs/core/http';
import access from '#config/access_control';
import { withActor } from '#services/auth/current_actor';
import { hasMultipleCompanies } from '#models/installation_company';

/** Returns the companies this principal may enter, or 409 while the installation has more than one. */
export default class CompaniesController {
  async index(ctx: HttpContext) {
    const summaries = await withActor(ctx, async (actor, trx) => {
      if (await hasMultipleCompanies(trx)) return null;
      const rows = await trx
        .from(`${access.config.membershipsTable} as member`)
        .innerJoin('accounts as account', 'account.id', 'member.scope_id')
        .where({ 'member.user_id': actor.userId, 'member.status': 'active' })
        .select('account.id', 'account.name', 'member.role');
      return rows.sort((left, right) => String(left.name).localeCompare(String(right.name)));
    });
    if (summaries === null) {
      return ctx.response.conflict({
        error:
          'This installation has more than one company. Contact the administrator to resolve it.',
        code: 'MULTIPLE_COMPANIES',
      });
    }
    return ctx.response.ok(summaries);
  }
}
