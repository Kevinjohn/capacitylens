import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import Closure from '#models/closure'
import { ClosureFactory } from '#database/factories/closure_factory'
import { CompanyFactory } from '#database/factories/company_factory'
import { transformRow } from '#transformers/row_transformer'
import { freshDatabase } from '#tests/helpers/fresh_database'

const company = { id: 'a-daily-planet', name: 'Daily Planet', color: '#123456' }
const closure = {
  id: 'cl-founders-day',
  companyId: company.id,
  name: 'Founders Day',
  startDate: '2026-12-01' as const,
  endDate: '2026-12-01' as const,
}

test.group('soft-delete marker column', (group) => {
  group.setup(() => freshDatabase())

  test('stores deleted_at in Lucid format and never sends it', async ({ assert }) => {
    const trx = await db.transaction()
    try {
      await CompanyFactory.client(trx).merge(company).create()
      const row = await ClosureFactory.client(trx).merge(closure).create()
      await row.useTransaction(trx).delete()

      const stored = await trx.from('closures').where('id', closure.id).firstOrFail()
      assert.match(stored.deleted_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)

      const trashed = await Closure.query({ client: trx })
        .onlyTrashed()
        .withScopes((scopes) => scopes.forCompany(company.id))
        .where('id', closure.id)
        .firstOrFail()
      assert.isTrue(trashed.deletedAt?.isValid)
      assert.notProperty(transformRow(trashed), 'deletedAt')

      await trashed.restore()
      const restored = await trx.from('closures').where('id', closure.id).firstOrFail()
      assert.isNull(restored.deleted_at)
    } finally {
      await trx.rollback()
    }
  })
})
