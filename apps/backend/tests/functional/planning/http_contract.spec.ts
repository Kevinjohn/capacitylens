import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { readState } from '#services/state_repository'
import {
  accountId,
  planningUrl,
  configureAuth,
  newAllocation,
  resetPlanningFixture,
  session,
  signIn,
  trusted,
} from './helpers.js'

test.group('authenticated typed planning transactions', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(async () => {
    await resetPlanningFixture()
  })

  test('read returns current authority, revision and confidential company rows', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie, userId } = await signIn(client, 'editor')
    const hidden = await db
      .from('clients')
      .where({ account_id: accountId })
      .whereNull('builtin')
      .first()
    await db
      .from('clients')
      .where('id', hidden.id)
      .update({ name: 'Wayne secret', is_private: 'true', code_name: 'Nightwing' })
    const response = await session(client.get(planningUrl), cookie).send()
    response.assertStatus(200)
    assert.equal(response.body().accountId, accountId)
    assert.equal(response.body().revision, 0)
    assert.equal(response.body().authority.actorId, userId)
    assert.equal(response.body().authority.role, 'editor')
    assert.isTrue(response.body().authority.canWrite)
    assert.notInclude(response.text(), 'Wayne secret')
    assert.isTrue(
      response
        .body()
        .data.clients.every((row: { accountId: string }) => row.accountId === accountId)
    )
    const foreign = await session(client.get('/api/accounts/a-loft/planning'), cookie).send()
    foreign.assertStatus(403)
    assert.equal(foreign.body().code, 'account_membership_lost')
    const anonymous = await trusted(client.get(planningUrl)).send()
    anonymous.assertStatus(401)
  })

  test('create and move commit once, stale and duplicate identities never commit again', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const data = await readState(accountId, true)
    const { cookie } = await signIn(client)
    const allocation = newAllocation(data)
    const mutationId = randomUUID()
    const input = {
      mutationId,
      baseRevision: 0,
      intent: { operation: 'allocation.create', allocation },
    }
    const created = await session(client.post(`/api/accounts/${accountId}/allocations`), cookie)
      .json(input)
      .send()
    created.assertStatus(200)
    assert.equal(created.body().revision, 1)
    assert.equal(created.body().status, 'committed')
    assert.equal(created.body().projection.mode, 'patch')
    assert.equal(
      created
        .body()
        .projection.changed.upserts.find(
          (entry: { row: { id: string } }) => entry.row.id === allocation.id
        ).entity,
      'allocations'
    )
    const duplicate = await session(client.post(`/api/accounts/${accountId}/allocations`), cookie)
      .json(input)
      .send()
    duplicate.assertStatus(409)
    assert.equal(duplicate.body().code, 'mutation_id_reused')
    const stale = await session(
      client.patch(`/api/accounts/${accountId}/allocations/${allocation.id}`),
      cookie
    )
      .json({
        mutationId: randomUUID(),
        baseRevision: 0,
        intent: {
          operation: 'allocation.update',
          id: allocation.id,
          changes: { startDate: '2026-11-09', endDate: '2026-11-13' },
        },
      })
      .send()
    stale.assertStatus(409)
    assert.equal(stale.body().code, 'stale_revision')
    const moved = await session(
      client.patch(`/api/accounts/${accountId}/allocations/${allocation.id}`),
      cookie
    )
      .json({
        mutationId: randomUUID(),
        baseRevision: 1,
        intent: {
          operation: 'allocation.update',
          id: allocation.id,
          changes: { startDate: '2026-11-09', endDate: '2026-11-13' },
        },
      })
      .send()
    moved.assertStatus(200)
    assert.equal(moved.body().revision, 2)
    assert.lengthOf(await db.from('planning_mutations').where('account_id', accountId), 2)
    assert.lengthOf(
      await db.from('audit_entries').where({ account_id: accountId, entity: 'planning' }),
      2
    )
  })

  test('occupied and missing entity targets use the validation transport mapping without effects', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await signIn(client)
    const allocation = newAllocation(await readState(accountId, true))
    const created = await session(client.post(`/api/accounts/${accountId}/allocations`), cookie)
      .json({
        mutationId: randomUUID(),
        baseRevision: 0,
        intent: { operation: 'allocation.create', allocation },
      })
      .send()
    created.assertStatus(200)
    const before = await readState(accountId, true)
    const occupied = await session(client.post(`/api/accounts/${accountId}/allocations`), cookie)
      .json({
        mutationId: randomUUID(),
        baseRevision: 1,
        intent: { operation: 'allocation.create', allocation },
      })
      .send()
    occupied.assertStatus(400)
    assert.equal(occupied.body().code, 'validation_error')
    const missingId = randomUUID()
    const missing = await session(
      client.patch(`/api/accounts/${accountId}/allocations/${missingId}`),
      cookie
    )
      .json({
        mutationId: randomUUID(),
        baseRevision: 1,
        intent: {
          operation: 'allocation.update',
          id: missingId,
          changes: { hoursPerDay: 4 },
        },
      })
      .send()
    missing.assertStatus(400)
    assert.equal(missing.body().code, 'validation_error')
    assert.deepEqual(await readState(accountId, true), before)
    assert.lengthOf(await db.from('planning_mutations').where('account_id', accountId), 1)
    assert.lengthOf(
      await db.from('audit_entries').where({ account_id: accountId, entity: 'planning' }),
      1
    )
  })

  test('lost response lookup is actor/company scoped and absent identity stays unknown', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await signIn(client)
    const allocation = newAllocation(await readState(accountId, true))
    const mutationId = randomUUID()
    const committed = await session(client.post(`/api/accounts/${accountId}/allocations`), cookie)
      .json({ mutationId, baseRevision: 0, intent: { operation: 'allocation.create', allocation } })
      .send()
    committed.assertStatus(200)
    const lookup = await session(
      client.get(`${planningUrl}/mutations/${mutationId}`),
      cookie
    ).send()
    lookup.assertStatus(200)
    assert.deepEqual(lookup.body(), { status: 'committed', mutationId, revision: 1 })
    const { cookie: otherCookie } = await signIn(client)
    const other = await session(
      client.get(`${planningUrl}/mutations/${mutationId}`),
      otherCookie
    ).send()
    assert.deepEqual(other.body(), { status: 'unknown', mutationId })
    const unknownId = randomUUID()
    const unknown = await session(
      client.get(`${planningUrl}/mutations/${unknownId}`),
      cookie
    ).send()
    assert.deepEqual(unknown.body(), { status: 'unknown', mutationId: unknownId })
    const foreign = await session(
      client.get(`/api/accounts/a-loft/planning/mutations/${mutationId}`),
      cookie
    ).send()
    foreign.assertStatus(403)
  })

  test('same-value update has no audit, commitment marker or revision advance', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await signIn(client)
    const data = await readState(accountId, true)
    const allocation = data.allocations.find((row) => row.accountId === accountId)!
    const before = await readState(accountId, true)
    const response = await session(
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
    response.assertStatus(400)
    assert.equal(response.body().code, 'no_change')
    assert.deepEqual(await readState(accountId, true), before)
    assert.lengthOf(await db.from('planning_mutations').where('account_id', accountId), 0)
    assert.lengthOf(
      await db.from('audit_entries').where({ account_id: accountId, entity: 'planning' }),
      0
    )
    const current = await session(client.get(planningUrl), cookie).send()
    assert.equal(current.body().revision, 0)
  })
})
