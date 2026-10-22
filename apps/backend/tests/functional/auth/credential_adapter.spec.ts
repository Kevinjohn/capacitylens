import { test } from '@japa/runner'
import { freshDatabase } from '../../helpers/fresh_database.js'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { usersAdapter, PasswordIneligibleError } from '#services/account_kit/users_adapter'

test.group('Account-kit product user adapter', (group) => {
  group.setup(() => freshDatabase())

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
    assert.equal(unverified?.unverifiedEmail, `${id}@example.test`)
    const rollback = new Error('rollback')
    await assert.rejects(
      () =>
        db.transaction(async (trx) => {
          await usersAdapter.markEmailVerified(id, DateTime.utc(), trx)
          const verifiedInTransaction = await usersAdapter.findById(id, trx)
          assert.isNotNull(verifiedInTransaction?.emailVerifiedAt)
          assert.isNull(verifiedInTransaction?.unverifiedEmail)
          throw rollback
        }),
      rollback.message
    )
    const afterRollback = await usersAdapter.findById(id)
    assert.isNull(afterRollback?.emailVerifiedAt)
    assert.equal(afterRollback?.unverifiedEmail, `${id}@example.test`)
    await db.transaction(async (trx) => {
      await assert.rejects(
        () => usersAdapter.setUnverifiedEmail(id, null, trx),
        /Email changes are unavailable/
      )
    })
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
