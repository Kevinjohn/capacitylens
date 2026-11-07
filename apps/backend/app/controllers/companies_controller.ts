import type { HttpContext } from '@adonisjs/core/http';
import db from '@adonisjs/lucid/services/db';
import access from '#config/access_control';
import { restrictedCompanyIds } from '#services/auth/authorization';
import { withActor } from '#services/auth/current_actor';
import { activeMembershipsByCompany } from '#services/membership/package_projection';

export default class CompaniesController {
  async index(ctx: HttpContext) {
    const installationAccounts = await db.from('accounts').count('* as count').first();
    if (Number(installationAccounts?.count ?? 0) > 1) {
      return ctx.response.conflict({
        error:
          'This installation has more than one company. Contact the administrator to resolve it.',
      });
    }
    const summaries = await withActor(ctx, async (actor, trx) => {
      const restricted = await restrictedCompanyIds(actor.userId, trx);
      const byCompany = await activeMembershipsByCompany(actor.userId, trx, restricted);
      const accounts = await trx
        .from('accounts')
        .whereIn('id', [...byCompany.keys()])
        .select('id', 'name');
      return accounts
        .map((account) => {
          const membership = byCompany.get(String(account.id));
          return {
            id: account.id,
            name: account.name,
            role: membership?.role,
            access: access.clientPayload(membership),
          };
        })
        .sort((left, right) => String(left.name).localeCompare(String(right.name)));
    });
    return ctx.response.ok(summaries);
  }
}
