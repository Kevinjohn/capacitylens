import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { withTransaction } from '#services/with_transaction'

test.group('M1 transaction helper', (group) => {
  group.setup(() => testUtils.db().migrate())

  test('rolls back every write when transactional work fails', async ({ assert }) => {
    await assert.rejects(
      () =>
        withTransaction(async (trx) => {
          await trx.table('accounts').insert({
            id: 'rollback-account',
            name: 'Rollback Account',
            color: '#2d75da',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          })
          throw new Error('force rollback')
        }),
      /force rollback/
    )
    const row = await db.from('accounts').where('id', 'rollback-account').first()
    assert.isNull(row)
  })
})
