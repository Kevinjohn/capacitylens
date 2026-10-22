import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { restrictedCompanyIds } from '#services/auth/authorization'
import { resolveCurrentActor } from '#services/auth/session_authority'
import { withTransaction } from '#services/with_transaction'

export default class CompaniesController {
  async index(ctx: HttpContext) {
    const installationAccounts = await db.from('accounts').count('* as count').first()
    if (Number(installationAccounts?.count ?? 0) > 1)
      return ctx.response.conflict({
        error:
          'This installation has more than one company. Contact the administrator to resolve it.',
      })
    const summaries = await withTransaction(async (trx) => {
      const actor = await resolveCurrentActor(ctx, trx)
      const restricted = await restrictedCompanyIds(actor.userId, trx)
      const rows = await trx
        .from('memberships as member')
        .innerJoin('accounts as account', 'account.id', 'member.account_id')
        .where({ 'member.user_id': actor.userId, 'member.status': 'active' })
        .select('account.id', 'account.name', 'member.role')
      return rows
        .filter((row) => !restricted.has(String(row.id)))
        .sort((left, right) => String(left.name).localeCompare(String(right.name)))
    })
    return ctx.response.ok(summaries)
  }
}
