import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
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

  test('an external commit waits for the planning snapshot, so authority, revision and projection never mix', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie, userId } = await signIn(client)
    const before = await readState(accountId, true)
    // Another process tries to commit while the planning read holds its snapshot. A connection in
    // this process could not stand in: a second SQLite copy does not see this process's locks.
    const externalCommit = () =>
      spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `import { DatabaseSync } from 'node:sqlite'
const [file, accountId, userId] = process.argv.slice(1)
const db = new DatabaseSync(file)
db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 0')
try {
  db.exec('BEGIN IMMEDIATE')
} catch {
  process.exit(3)
}
db.prepare('UPDATE accounts SET name = ? WHERE id = ?').run('Wayne Revised', accountId)
db.prepare('UPDATE memberships SET role = ? WHERE user_id = ? AND account_id = ?').run('viewer', userId, accountId)
db.prepare('INSERT INTO company_planning_revisions(account_id, revision) VALUES (?, 1) ON CONFLICT(account_id) DO UPDATE SET revision = 1').run(accountId)
db.exec('COMMIT')`,
          env.get('CAPACITYLENS_DB')!,
          accountId,
          userId,
        ],
        { stdio: ['ignore', 'ignore', 'inherit'] }
      ).status
    const knex = db.connection().getReadClient()
    let attempted: number | null = null
    const interleave = (_rows: unknown, query: { sql?: unknown }) => {
      if (
        attempted !== null ||
        typeof query.sql !== 'string' ||
        !query.sql.includes('company_planning_revisions') ||
        !query.sql.startsWith('select')
      )
        return
      attempted = externalCommit()
    }
    knex.on('query-response', interleave)
    try {
      const snapshot = await session(client.get(planningUrl), cookie).send()
      snapshot.assertStatus(200)
      assert.equal(attempted, 3, 'the external writer waits for the snapshot')
      assert.equal(snapshot.body().revision, 0)
      assert.equal(snapshot.body().authority.role, 'owner')
      assert.equal(snapshot.body().data.accounts[0].name, before.accounts[0]!.name)
    } finally {
      knex.off('query-response', interleave)
    }
    assert.equal(externalCommit(), 0)
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
