import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { withTransaction } from '#services/with_transaction'
import {
  advancePlanningRevision,
  advanceRevisionsForNewEmailProof,
  getPlanningRevision,
} from '#services/planning_revision'
import { replaceWithSeed } from '#services/state_repository'

test.group('company planning revision storage', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(() => replaceWithSeed())

  test('defaults old companies to zero and advances once per company transaction', async ({
    assert,
  }) => {
    assert.equal(await withTransaction((trx) => getPlanningRevision(trx, 'a-studio')), 0)

    const results = await withTransaction(async (trx) => {
      const first = await advancePlanningRevision(trx, 'a-studio')
      const repeated = await advancePlanningRevision(trx, 'a-studio')
      const otherCompany = await advancePlanningRevision(trx, 'a-loft')
      assert.equal(await getPlanningRevision(trx, 'a-studio'), 1)
      return [first, repeated, otherCompany]
    })
    assert.deepEqual(results, [1, 1, 1])
    assert.equal(await withTransaction((trx) => getPlanningRevision(trx, 'a-studio')), 1)
    assert.equal(await withTransaction((trx) => advancePlanningRevision(trx, 'a-studio')), 2)
  })

  test('rolls back a revision advance with the caller transaction', async ({ assert }) => {
    await assert.rejects(
      () =>
        withTransaction(async (trx) => {
          await advancePlanningRevision(trx, 'a-studio')
          throw new Error('rollback')
        }),
      /rollback/
    )
    assert.equal(await withTransaction((trx) => getPlanningRevision(trx, 'a-studio')), 0)
    assert.isNull(
      await db.from('company_planning_revisions').where('account_id', 'a-studio').first()
    )
  })

  test('advances active member companies restricted by a newly proven mailbox only once', async ({
    assert,
  }) => {
    const userId = 'proof-revision-user'
    const email = 'proof-revision@wayne.example'
    const now = new Date().toISOString()
    await db.table('users').insert({
      id: userId,
      email,
      email_verified: false,
      display_name: 'Diana Prince',
      password_hash: null,
      created_at: now,
      updated_at: now,
    })
    await db.table('memberships').insert({
      id: 'proof-revision-membership',
      account_id: 'a-studio',
      user_id: userId,
      role: 'editor',
      status: 'active',
      created_at: now,
      updated_at: now,
    })
    await db.table('account_access_restrictions').insert({
      id: 'proof-revision-email-restriction',
      account_id: 'a-studio',
      principal_id: 'other-principal',
      verified_email: email,
      role: 'viewer',
      created_at: now,
    })

    await withTransaction(async (trx) => {
      await advanceRevisionsForNewEmailProof(trx, userId, email)
      await trx.table('email_proofs').insert({
        id: 'proof-revision-proof',
        user_id: userId,
        email,
        verified_at: now,
        created_at: now,
        updated_at: now,
      })
    })
    assert.equal(await withTransaction((trx) => getPlanningRevision(trx, 'a-studio')), 1)
    await withTransaction((trx) => advanceRevisionsForNewEmailProof(trx, userId, email))
    assert.equal(await withTransaction((trx) => getPlanningRevision(trx, 'a-studio')), 1)
  })

  test('does not advance when the member already has direct restricted access', async ({
    assert,
  }) => {
    const userId = 'proof-revision-direct-user'
    const email = 'proof-revision-direct@wayne.example'
    const now = new Date().toISOString()
    await db.table('users').insert({
      id: userId,
      email,
      email_verified: false,
      display_name: 'Diana Prince',
      password_hash: null,
      created_at: now,
      updated_at: now,
    })
    await db.table('memberships').insert({
      id: 'proof-revision-direct-membership',
      account_id: 'a-studio',
      user_id: userId,
      role: 'editor',
      status: 'active',
      created_at: now,
      updated_at: now,
    })
    await db.table('account_access_restrictions').insert([
      {
        id: 'proof-revision-direct-restriction',
        account_id: 'a-studio',
        principal_id: userId,
        verified_email: null,
        role: 'editor',
        created_at: now,
      },
      {
        id: 'proof-revision-other-restriction',
        account_id: 'a-studio',
        principal_id: 'other-principal',
        verified_email: email,
        role: 'viewer',
        created_at: now,
      },
    ])

    await withTransaction((trx) => advanceRevisionsForNewEmailProof(trx, userId, email))
    assert.equal(await withTransaction((trx) => getPlanningRevision(trx, 'a-studio')), 0)
  })
})
