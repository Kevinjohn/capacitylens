import type { HttpContext } from '@adonisjs/core/http';
import db from '@adonisjs/lucid/services/db';
import access from '#config/access_control';
import { withActor } from '#services/auth/current_actor';
import { hasMultipleCompanies } from '#services/installation_company';

export default class CompaniesController {
  async index(ctx: HttpContext) {
    if (await hasMultipleCompanies(db)) {
      return ctx.response.conflict({
        error:
          'This installation has more than one company. Contact the administrator to resolve it.',
      });
    }
    const summaries = await withActor(ctx, async (actor, trx) => {
      const rows = await trx
        .from(`${access.config.membershipsTable} as member`)
        .innerJoin('accounts as account', 'account.id', 'member.scope_id')
        .where({ 'member.user_id': actor.userId, 'member.status': 'active' })
        .select('account.id', 'account.name', 'member.role');
      return rows.sort((left, right) => String(left.name).localeCompare(String(right.name)));
    });
    return ctx.response.ok(summaries);
  }
}
