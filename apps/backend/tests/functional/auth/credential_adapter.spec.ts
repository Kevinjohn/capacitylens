import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { usersAdapter, PasswordIneligibleError } from '#services/account_kit/users_adapter'

test.group('Account-kit product user adapter', (group) => {
  group.setup(() => testUtils.db().migrate())

  test('uses the supplied transaction and the boolean verification authority', async ({
    assert,
  }) => {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    await db.table('users').insert({
      id,
      email: `${id}@example.test`,
      email_verified: false,
      password_hash: null,
      display_name: 'Bruce Wayne',
      created_at: now,
      updated_at: now,
    })
    const unverified = await usersAdapter.findById(id)
    assert.isNull(unverified?.emailVerifiedAt)
    const rollback = new Error('rollback')
    await assert.rejects(
      () =>
        db.transaction(async (trx) => {
          await usersAdapter.markEmailVerified(id, DateTime.utc(), trx)
          const verifiedInTransaction = await usersAdapter.findById(id, trx)
          assert.isNotNull(verifiedInTransaction?.emailVerifiedAt)
          throw rollback
        }),
      rollback.message
    )
    const afterRollback = await usersAdapter.findById(id)
    assert.isNull(afterRollback?.emailVerifiedAt)
    await db.transaction(async (trx) => {
      await assert.rejects(
        () => usersAdapter.setPassword(id, 'new password', trx),
        PasswordIneligibleError
      )
    })
    const unchanged = await db.from('users').where('id', id).first()
    assert.isNull(unchanged?.password_hash)
  })
})
