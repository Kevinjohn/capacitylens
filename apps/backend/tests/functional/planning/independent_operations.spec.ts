import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import { freshDatabase } from '../../helpers/fresh_database.js'
import db from '@adonisjs/lucid/services/db'
import { readState } from '#services/state_repository'
import {
  accountId,
  configureAuth,
  newAllocation,
  planningUrl,
  resetPlanningFixture,
  session,
  signIn,
  trusted,
} from './helpers.js'

const route = (path: string) => `/api/accounts/${accountId}/${path}`
const input = (baseRevision: number, intent: Record<string, unknown>) => ({
  mutationId: randomUUID(),
  baseRevision,
  intent,
})
const body = (response: { body(): unknown }) =>
  response.body() as {
    code?: string
    revision?: number
    projection?: { mode: string; history: string }
  }

test.group('independent typed planning operations', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await resetPlanningFixture()
  })

  test('creates one homogeneous allocation series and permits a later Sunday occurrence', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const data = await readState(accountId, true)
    const { cookie } = await signIn(client)
    const first = newAllocation(data)
    const later = {
      ...first,
      id: randomUUID(),
      startDate: '2026-11-08',
      endDate: '2026-11-12',
    }
    const committed = await session(client.post(route('allocations/create-group')), cookie)
      .json(input(0, { operation: 'allocation.createGroup', allocations: [first, later] }))
      .send()

    committed.assertStatus(200)
    assert.equal(body(committed).revision, 1)
    assert.equal(body(committed).projection?.mode, 'patch')
    assert.equal(body(committed).projection?.history, 'retain')
    const saved = await readState(accountId, true)
    const created = [first.id, later.id].map((id) => saved.allocations.find((row) => row.id === id))
    assert.isDefined(created[0])
    assert.isDefined(created[1])
    assert.isNotEmpty(created[0]!.seriesId)
    assert.equal(created[1]!.seriesId, created[0]!.seriesId)
    assert.equal(created[1]!.startDate, later.startDate)
    assert.lengthOf(await db.from('planning_mutations').where('account_id', accountId), 1)
  })

  test('refuses heterogeneous allocation groups before persisting any occurrence', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const data = await readState(accountId, true)
    const { cookie } = await signIn(client)
    const first = newAllocation(data)
    const otherResource = data.resources.find(
      (row) => row.accountId === accountId && row.kind === 'person' && row.id !== first.resourceId
    )!
    const heterogeneous = {
      ...first,
      id: randomUUID(),
      resourceId: otherResource.id,
      startDate: '2026-11-08',
      endDate: '2026-11-12',
    }
    const before = await readState(accountId, true)
    const refused = await session(client.post(route('allocations/create-group')), cookie)
      .json(input(0, { operation: 'allocation.createGroup', allocations: [first, heterogeneous] }))
      .send()

    refused.assertStatus(400)
    assert.equal(body(refused).code, 'validation_error')
    assert.deepEqual(await readState(accountId, true), before)
    const snapshot = await session(client.get(planningUrl), cookie).send()
    assert.equal(snapshot.body().revision, 0)
    assert.lengthOf(await db.from('planning_mutations').where('account_id', accountId), 0)
    assert.lengthOf(
      await db.from('audit_entries').where({ account_id: accountId, entity: 'planning' }),
      0
    )
  })

  test('archives and unarchives catalogue and resource rows by their same stable IDs', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const data = await readState(accountId, true)
    const { cookie } = await signIn(client)
    const clientId = data.clients.find((row) => row.accountId === accountId && !row.builtin)!.id
    const resourceId = data.resources.find(
      (row) => row.accountId === accountId && row.kind === 'person' && !row.archivedAt
    )!.id
    const transitions = [
      {
        path: `clients/${clientId}/archive`,
        operation: 'catalogue.archive',
        entity: { entity: 'clients', id: clientId },
        entityTable: 'clients',
        id: clientId,
      },
      {
        path: `clients/${clientId}/unarchive`,
        operation: 'catalogue.unarchive',
        entity: { entity: 'clients', id: clientId },
        entityTable: 'clients',
        id: clientId,
      },
      {
        path: `resources/${resourceId}/archive`,
        operation: 'resource.archive',
        id: resourceId,
        entityTable: 'resources',
      },
      {
        path: `resources/${resourceId}/unarchive`,
        operation: 'resource.unarchive',
        id: resourceId,
        entityTable: 'resources',
      },
    ] as const

    for (const [index, transition] of transitions.entries()) {
      const mutationId = randomUUID()
      const response = await session(client.post(route(transition.path)), cookie)
        .json({
          mutationId,
          baseRevision: index,
          intent: {
            operation: transition.operation,
            ...('entity' in transition ? { entity: transition.entity } : { id: transition.id }),
          },
        })
        .send()
      response.assertStatus(200)
      assert.equal(body(response).revision, index + 1)
      const row = await db.from(transition.entityTable).where({ id: transition.id }).first()
      assert.isDefined(row)
      assert.equal(row!.id, transition.id)
      assert.equal(Boolean(row!.archived_at), index === 0 || index === 2)
      const marker = await db
        .from('planning_mutations')
        .where({ account_id: accountId, mutation_id: mutationId })
        .first()
      assert.equal(Number(marker?.revision), index + 1)
      const audit = await db
        .from('audit_entries')
        .where({ account_id: accountId, entity: 'planning', entity_id: marker!.mutation_id })
        .first()
      assert.equal(audit?.action, transition.operation)
    }

    const final = await readState(accountId, true)
    assert.isNull(final.clients.find((row) => row.id === clientId)!.archivedAt)
    assert.isNull(final.resources.find((row) => row.id === resourceId)!.archivedAt)
    const snapshot = await session(client.get(planningUrl), cookie).send()
    assert.equal(snapshot.body().revision, 4)
    assert.lengthOf(await db.from('planning_mutations').where('account_id', accountId), 4)
    assert.lengthOf(
      await db.from('audit_entries').where({ account_id: accountId, entity: 'planning' }),
      4
    )
  })

  test('missing targets and same-state lifecycle transitions keep their flat refusal codes', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const data = await readState(accountId, true)
    const { cookie } = await signIn(client)
    const clientId = data.clients.find((row) => row.accountId === accountId && !row.builtin)!.id
    const missingId = randomUUID()

    const alreadyActive = await session(client.post(route(`clients/${clientId}/unarchive`)), cookie)
      .json(
        input(0, { operation: 'catalogue.unarchive', entity: { entity: 'clients', id: clientId } })
      )
      .send()
    alreadyActive.assertStatus(400)
    assert.equal(body(alreadyActive).code, 'no_change')
    assert.deepEqual(Object.keys(alreadyActive.body() as object).sort(), ['code', 'error'])

    const missing = await session(client.post(route(`clients/${missingId}/archive`)), cookie)
      .json(
        input(0, { operation: 'catalogue.archive', entity: { entity: 'clients', id: missingId } })
      )
      .send()
    missing.assertStatus(400)
    assert.equal(body(missing).code, 'validation_error')
    assert.deepEqual(Object.keys(missing.body() as object).sort(), ['code', 'error'])

    const archived = await session(client.post(route(`clients/${clientId}/archive`)), cookie)
      .json(
        input(0, { operation: 'catalogue.archive', entity: { entity: 'clients', id: clientId } })
      )
      .send()
    archived.assertStatus(200)
    const repeated = await session(client.post(route(`clients/${clientId}/archive`)), cookie)
      .json(
        input(1, { operation: 'catalogue.archive', entity: { entity: 'clients', id: clientId } })
      )
      .send()
    repeated.assertStatus(400)
    assert.equal(body(repeated).code, 'no_change')
    assert.deepEqual(Object.keys(repeated.body() as object).sort(), ['code', 'error'])

    const snapshot = await session(client.get(planningUrl), cookie).send()
    assert.equal(snapshot.body().revision, 1)
    assert.lengthOf(await db.from('planning_mutations').where('account_id', accountId), 1)
    assert.lengthOf(
      await db.from('audit_entries').where({ account_id: accountId, entity: 'planning' }),
      1
    )
  })

  test('the built-in Internal client rejects both lifecycle verbs without mutation', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const data = await readState(accountId, true)
    const { cookie } = await signIn(client)
    const internal = data.clients.find((row) => row.accountId === accountId && row.builtin)!
    const before = await db.from('clients').where({ id: internal.id }).first()
    assert.isDefined(before)

    for (const [action, operation] of [
      ['archive', 'catalogue.archive'],
      ['unarchive', 'catalogue.unarchive'],
    ] as const) {
      const response = await session(client.post(route(`clients/${internal.id}/${action}`)), cookie)
        .json(
          input(0, {
            operation,
            entity: { entity: 'clients', id: internal.id },
          })
        )
        .send()
      response.assertStatus(409)
      assert.deepEqual(await db.from('clients').where({ id: internal.id }).first(), before)
    }

    const snapshot = await session(client.get(planningUrl), cookie).send()
    assert.equal(snapshot.body().revision, 0)
    assert.lengthOf(await db.from('planning_mutations').where('account_id', accountId), 0)
    assert.lengthOf(
      await db.from('audit_entries').where({ account_id: accountId, entity: 'planning' }),
      0
    )
  })

  test('anonymous planning cannot read or write persisted allocations', async ({
    client,
    assert,
  }) => {
    const snapshot = await trusted(client.get(planningUrl)).send()
    snapshot.assertStatus(401)

    const allocation = newAllocation(await readState(accountId, true))
    const before = await readState(accountId, true)
    const write = await trusted(client.post(route('allocations')))
      .json(input(0, { operation: 'allocation.create', allocation }))
      .send()
    write.assertStatus(401)
    assert.deepEqual(write.body(), { error: 'Sign-in required.' })
    assert.deepEqual(await readState(accountId, true), before)
    assert.lengthOf(await db.from('planning_mutations').where('account_id', accountId), 0)
    assert.lengthOf(
      await db.from('audit_entries').where({ account_id: accountId, entity: 'planning' }),
      0
    )
  })
})
