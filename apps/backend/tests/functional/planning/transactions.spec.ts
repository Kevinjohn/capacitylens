import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { test } from '@japa/runner'
import { freshDatabase } from '../../helpers/fresh_database.js'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { readState } from '#services/state_repository'
import {
  accountId,
  planningUrl,
  configureAuth,
  newAllocation,
  resetPlanningFixture,
  session,
  signIn,
} from './helpers.js'

test.group('planning snapshot and commit boundaries', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await resetPlanningFixture()
  })

  test('a concurrent external commit cannot mix authority, revision and projection snapshots', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie, userId } = await signIn(client)
    const before = await readState(accountId, true)
    // A separate test connection commits after the planning transaction reads its revision.
    // This adversarial writer is outside the application's single-connection pool.
    const external = new DatabaseSync(env.get('CAPACITYLENS_DB')!)
    external.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 1000')
    const knex = db.connection().getReadClient()
    let committed = false
    const interleave = (_rows: unknown, query: { sql?: unknown }) => {
      if (
        committed ||
        typeof query.sql !== 'string' ||
        !query.sql.includes('company_planning_revisions') ||
        !query.sql.startsWith('select')
      )
        return
      committed = true
      external.exec('BEGIN IMMEDIATE')
      external.prepare('UPDATE accounts SET name = ? WHERE id = ?').run('Wayne Revised', accountId)
      external
        .prepare('UPDATE memberships SET role = ? WHERE user_id = ? AND account_id = ?')
        .run('viewer', userId, accountId)
      external
        .prepare(
          'INSERT INTO company_planning_revisions(account_id, revision) VALUES (?, 1) ON CONFLICT(account_id) DO UPDATE SET revision = 1'
        )
        .run(accountId)
      external.exec('COMMIT')
    }
    knex.on('query-response', interleave)
    try {
      const snapshot = await session(client.get(planningUrl), cookie).send()
      snapshot.assertStatus(200)
      assert.isTrue(committed)
      assert.equal(snapshot.body().revision, 0)
      assert.equal(snapshot.body().authority.role, 'owner')
      assert.equal(snapshot.body().data.accounts[0].name, before.accounts[0]!.name)
    } finally {
      knex.off('query-response', interleave)
      external.close()
    }
    const current = await session(client.get(planningUrl), cookie).send()
    current.assertStatus(200)
    assert.equal(current.body().revision, 1)
    assert.equal(current.body().authority.role, 'viewer')
    assert.isFalse(current.body().authority.canWrite)
    assert.equal(current.body().data.accounts[0].name, 'Wayne Revised')
  })

  test('audit failure rolls back rows, revision and commitment identity together', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await signIn(client)
    const before = await readState(accountId, true)
    const allocation = newAllocation(before)
    const mutationId = randomUUID()
    await db.rawQuery(
      "CREATE TEMP TRIGGER planning_audit_failure BEFORE INSERT ON audit_entries WHEN NEW.entity = 'planning' BEGIN SELECT RAISE(ABORT, 'test audit failure'); END"
    )
    try {
      const failed = await session(client.post(`/api/accounts/${accountId}/allocations`), cookie)
        .json({
          mutationId,
          baseRevision: 0,
          intent: { operation: 'allocation.create', allocation },
        })
        .send()
      failed.assertStatus(500)
    } finally {
      await db.rawQuery('DROP TRIGGER planning_audit_failure')
    }
    assert.deepEqual(await readState(accountId, true), before)
    assert.lengthOf(await db.from('company_planning_revisions').where('account_id', accountId), 0)
    assert.lengthOf(await db.from('planning_mutations').where('account_id', accountId), 0)
    const lookup = await session(
      client.get(`${planningUrl}/mutations/${mutationId}`),
      cookie
    ).send()
    assert.deepEqual(lookup.body(), { status: 'unknown', mutationId })
  })

  test('competing drafts at one revision permit one commit and never rebase the other', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await signIn(client)
    const data = await readState(accountId, true)
    const allocations = [newAllocation(data), newAllocation(data)]
    const replies = await Promise.all(
      allocations.map((allocation) =>
        session(client.post(`/api/accounts/${accountId}/allocations`), cookie)
          .json({
            mutationId: randomUUID(),
            baseRevision: 0,
            intent: { operation: 'allocation.create', allocation },
          })
          .send()
      )
    )
    assert.deepEqual(replies.map((reply) => reply.status()).sort(), [200, 409])
    assert.equal(replies.find((reply) => reply.status() === 409)!.body().code, 'stale_revision')
    assert.lengthOf(await db.from('planning_mutations').where('account_id', accountId), 1)
    assert.lengthOf(
      await db.from('allocations').whereIn(
        'id',
        allocations.map((row) => row.id)
      ),
      1
    )
    const current = await session(client.get(planningUrl), cookie).send()
    assert.equal(current.body().revision, 1)
  })

  test('unknown is compatible with a later commit and simultaneous duplicate requests commit once', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await signIn(client)
    const mutationId = randomUUID()
    const lookup = await session(
      client.get(`${planningUrl}/mutations/${mutationId}`),
      cookie
    ).send()
    assert.deepEqual(lookup.body(), { status: 'unknown', mutationId })
    const allocation = newAllocation(await readState(accountId, true))
    const input = {
      mutationId,
      baseRevision: 0,
      intent: { operation: 'allocation.create', allocation },
    }
    const replies = await Promise.all(
      [1, 2].map(() =>
        session(client.post(`/api/accounts/${accountId}/allocations`), cookie)
          .json(input)
          .send()
      )
    )
    assert.deepEqual(replies.map((reply) => reply.status()).sort(), [200, 409])
    assert.equal(replies.find((reply) => reply.status() === 409)!.body().code, 'mutation_id_reused')
    const committed = await session(
      client.get(`${planningUrl}/mutations/${mutationId}`),
      cookie
    ).send()
    assert.deepEqual(committed.body(), { status: 'committed', mutationId, revision: 1 })
    assert.lengthOf(await db.from('allocations').where('id', allocation.id), 1)
  })

  test('read-only masquerade cannot gain planning write authority', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const owner = await signIn(client)
    const target = await signIn(client, 'editor')
    const start = await session(client.post(`/api/accounts/${accountId}/masquerade`), owner.cookie)
      .json({ targetUserId: target.userId })
      .send()
    start.assertStatus(200)
    const snapshot = await session(client.get(planningUrl), owner.cookie).send()
    snapshot.assertStatus(200)
    assert.equal(snapshot.body().authority.effectiveActorId, target.userId)
    assert.isFalse(snapshot.body().authority.canWrite)
    const allocation = newAllocation(await readState(accountId, true))
    const refused = await session(
      client.post(`/api/accounts/${accountId}/allocations`),
      owner.cookie
    )
      .json({
        mutationId: randomUUID(),
        baseRevision: 0,
        intent: { operation: 'allocation.create', allocation },
      })
      .send()
    refused.assertStatus(403)
    assert.lengthOf(await db.from('planning_mutations').where('account_id', accountId), 0)
  })
  test('a rejected no-change operation keeps the real session usable across a transactional idle touch', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await signIn(client)
    const indexed = await db.from('user_session_index').first()
    const data = await readState(accountId, true)
    const allocation = data.allocations[0]!
    const originalNow = Date.now
    const knex = db.connection().getReadClient()
    let crossedTouchBoundary = false
    const crossBoundary = (query: { sql?: unknown }) => {
      if (typeof query.sql === 'string' && /^begin/i.test(query.sql)) {
        crossedTouchBoundary = true
        Date.now = () => Number(indexed.last_activity_at) + 60_000
      }
    }
    Date.now = () => Number(indexed.last_activity_at) + 59_000
    knex.on('query', crossBoundary)
    try {
      const noChange = await session(
        client.patch(`/api/accounts/${accountId}/allocations/${allocation.id}`),
        cookie
      )
        .json({
          mutationId: randomUUID(),
          baseRevision: 0,
          intent: {
            operation: 'allocation.update',
            id: allocation.id,
            changes: { hoursPerDay: allocation.hoursPerDay },
          },
        })
        .send()
      noChange.assertStatus(400)
      assert.equal(noChange.body().code, 'no_change')
      assert.isTrue(crossedTouchBoundary)
      knex.off('query', crossBoundary)
      const current = await session(client.get(planningUrl), cookie).send()
      current.assertStatus(200)
      assert.equal(current.body().revision, 0)
    } finally {
      Date.now = originalNow
      knex.off('query', crossBoundary)
    }
  })
  for (const invalidation of [
    'actor membership',
    'target membership',
    'actor permission',
  ] as const) {
    test(`reports ${invalidation} loss during view-as as planning context loss`, async ({
      client,
      assert,
      cleanup,
    }) => {
      configureAuth(cleanup)
      const owner = await signIn(client)
      const target = await signIn(client, 'editor')
      const started = await session(
        client.post(`/api/accounts/${accountId}/masquerade`),
        owner.cookie
      )
        .json({ targetUserId: target.userId })
        .send()
      started.assertStatus(200)
      const before = await session(client.get(planningUrl), owner.cookie).send()
      before.assertStatus(200)
      await db
        .from('memberships')
        .where({
          account_id: accountId,
          user_id: invalidation === 'target membership' ? target.userId : owner.userId,
        })
        .update(invalidation === 'actor permission' ? { role: 'editor' } : { status: 'archived' })
      const lost = await session(client.get(planningUrl), owner.cookie).send()
      lost.assertStatus(403)
      assert.equal(lost.body().code, 'account_membership_lost')
      assert.isUndefined(lost.body().data)
      assert.lengthOf(await db.from('planning_mutations').where('account_id', accountId), 0)
    })
  }
})
