import db from '@adonisjs/lucid/services/db'
import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import { rejectUnknownFields } from '#validators/rules/unknown_fields'
import AccountGettingStartedDismissal from '#models/account_getting_started_dismissal'
import { withTransaction } from '#services/with_transaction'

const dismissal = vine.compile(
  vine.object({ dismissed: vine.literal(true) }).use(rejectUnknownFields(['dismissed']))
)

async function accountExists(accountId: string) {
  return Boolean(await db.from('accounts').select('id').where('id', accountId).first())
}

export default class GettingStartedController {
  async show({ params, response }: HttpContext) {
    if (!(await accountExists(params.accountId)))
      return response.notFound({ error: 'Company not found.' })
    const row = await AccountGettingStartedDismissal.query({ client: db.connection() })
      .withScopes((scopes) => scopes.forCompany(params.accountId))
      .first()
    return response.ok({ dismissed: Boolean(row) })
  }

  async update({ params, request, response }: HttpContext) {
    try {
      await request.validateUsing(dismissal, { data: request.body() })
    } catch {
      return response.badRequest({ error: 'dismissed must be true.' })
    }
    if (!(await accountExists(params.accountId)))
      return response.notFound({ error: 'Company not found.' })
    const now = new Date().toISOString()
    await withTransaction((trx) =>
      trx
        .table('account_getting_started_dismissals')
        .insert({
          id: crypto.randomUUID(),
          account_id: params.accountId,
          created_at: now,
          updated_at: now,
        })
        .onConflict('account_id')
        .ignore()
    )
    return response.ok({ dismissed: true })
  }
}
