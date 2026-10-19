import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import { rejectUnknownFields } from '#validators/rules/unknown_fields'
import { withTransaction } from '#services/with_transaction'
import { assertCompanyAction } from '#services/auth/authorization'

const dismissal = vine.compile(
  vine.object({ dismissed: vine.literal(true) }).use(rejectUnknownFields(['dismissed']))
)

export default class GettingStartedController {
  async show(ctx: HttpContext) {
    const { params, response } = ctx
    return withTransaction(async (trx) => {
      await assertCompanyAction(ctx, params.accountId, 'read', trx)
      if (!(await trx.from('accounts').where('id', params.accountId).first()))
        return response.notFound({ error: 'Company not found.' })
      const row = await trx
        .from('account_getting_started_dismissals')
        .where('account_id', params.accountId)
        .first()
      return response.ok({ dismissed: Boolean(row) })
    })
  }

  async update(ctx: HttpContext) {
    const { params, request, response } = ctx
    try {
      await request.validateUsing(dismissal, { data: request.body() })
    } catch {
      return response.badRequest({ error: 'dismissed must be true.' })
    }
    const now = new Date().toISOString()
    const exists = await withTransaction(async (trx) => {
      await assertCompanyAction(ctx, params.accountId, 'write', trx)
      if (!(await trx.from('accounts').where('id', params.accountId).first())) return false
      await trx
        .table('account_getting_started_dismissals')
        .insert({
          id: crypto.randomUUID(),
          account_id: params.accountId,
          created_at: now,
          updated_at: now,
        })
        .onConflict('account_id')
        .ignore()
      return true
    })
    if (!exists) return response.notFound({ error: 'Company not found.' })
    return response.ok({ dismissed: true })
  }
}
