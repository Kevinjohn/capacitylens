import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import Migration from '#database/migrations/1795478400000_store_deletion_markers_in_lucid_format_table'
import { freshDatabase } from '#tests/helpers/fresh_database'
import { CompanyFactory } from '#database/factories/company_factory'

const now = '2026-11-24T09:00:00.000Z'

test.group('deletion marker migration', (group) => {
  group.setup(() => freshDatabase())

  test('refuses rollback of the irreversible marker conversion', async ({ assert }) => {
    await db.transaction(async (trx) => {
      const migration = new Migration(trx, 'deletion_marker_migration', false)
      await assert.rejects(() => migration.execDown(), 'This migration cannot be reversed')
    })
  })

  test('rewrites ISO markers in Lucid format and leaves other rows alone', async ({ assert }) => {
    const trx = await db.transaction()
    try {
      await CompanyFactory.client(trx)
        .merge({ id: 'a-daily-planet', name: 'Daily Planet' })
        .create()
      const closure = (id: string, deletedAt: string | null) => ({
        id,
        company_id: 'a-daily-planet',
        name: `Closure ${id}`,
        start_date: '2026-12-01',
        end_date: '2026-12-01',
        created_at: now,
        updated_at: now,
        deleted_at: deletedAt,
      })
      await trx
        .table('closures')
        .multiInsert([
          closure('cl-iso', '2026-11-24T10:11:12.013Z'),
          closure('cl-lucid', '2026-11-20 08:09:10'),
          closure('cl-live', null),
        ])

      await new Migration(trx, 'deletion_marker_migration', false).execUp()

      const stored = await trx.from('closures').select('id', 'deleted_at').orderBy('id')
      assert.deepEqual(stored, [
        { id: 'cl-iso', deleted_at: '2026-11-24 10:11:12' },
        { id: 'cl-live', deleted_at: null },
        { id: 'cl-lucid', deleted_at: '2026-11-20 08:09:10' },
      ])
    } finally {
      await trx.rollback()
    }
  })
})
