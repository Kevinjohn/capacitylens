import assert from 'node:assert/strict'
import type { ApiClient } from '@japa/api-client'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import {
  FIXTURE_ACCOUNT,
  FIXTURE_ACTIVITY,
  FIXTURE_ACTIVITY_INTERNAL,
  FIXTURE_ACTIVITY_REPEATABLE,
  FIXTURE_ALLOCATION,
  FIXTURE_ALLOCATION_ATTRIBUTED,
  FIXTURE_CLIENT,
  FIXTURE_DISCIPLINE,
  FIXTURE_PHASE,
  FIXTURE_PROJECT,
  FIXTURE_RESOURCE,
  FIXTURE_RESOURCE_EXTERNAL,
  FIXTURE_RESOURCE_PERSON,
  FIXTURE_TIMEOFF,
} from '@capacitylens/shared/data/fixtures'
import type { AppData } from '@capacitylens/shared/types/entities'
import { stripLifecycle } from './state/database_contract_cases.js'
import { trusted } from './batch/ordering_helpers.js'

type FixtureRow = { id: string }
type FixtureWrite = { table: string; row: FixtureRow }

async function resetEmpty(client: ApiClient) {
  const response = await client.post('/api/test/reset').json({ seed: false }).send()
  response.assertStatus(200)
}

function put(table: string, fixture: FixtureRow): FixtureWrite {
  return { table, row: fixture }
}

function dependencies(): FixtureWrite[] {
  return [
    put('accounts', FIXTURE_ACCOUNT),
    put('clients', stripLifecycle(FIXTURE_CLIENT)),
    put('disciplines', FIXTURE_DISCIPLINE),
    put('projects', stripLifecycle(FIXTURE_PROJECT)),
    put('phases', FIXTURE_PHASE),
  ]
}

async function write(client: ApiClient, fixtures: FixtureWrite[]) {
  const response = await trusted(client.post('/api/batch'))
    .json({
      ops: fixtures.map(({ table, row: fixture }) => ({
        method: 'PUT',
        table,
        id: fixture.id,
        row: fixture,
      })),
    } as never)
    .send()
  response.assertStatus(200)
}

async function state(client: ApiClient) {
  const response = await client
    .get(`/api/state?accountId=${FIXTURE_ACCOUNT.id}&includeInactive=1`)
    .send()
  response.assertStatus(200)
  return response.body() as AppData
}

function row<K extends keyof AppData>(data: AppData, table: K, id: string) {
  const rows = data[table] as unknown as Array<Record<string, unknown>>
  const found = rows.find((candidate) => candidate.id === id)
  assert.ok(found, `expected ${String(table)} row ${id}`)
  assert.equal(typeof found.createdAt, 'string', `${String(table)}.${id} has createdAt`)
  assert.equal(typeof found.updatedAt, 'string', `${String(table)}.${id} has updatedAt`)
  return found as Record<string, unknown> & Revisioned
}

type Revisioned = { createdAt: string; updatedAt: string }

function withoutRevision(value: Revisioned) {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== 'createdAt' && key !== 'updatedAt')
  )
}

function assertFixture(actual: Revisioned, expected: Revisioned) {
  assert.deepEqual(withoutRevision(actual), withoutRevision(expected))
  assert.ok(Number.isFinite(Date.parse(String(actual.createdAt))), 'createdAt is a valid timestamp')
  assert.ok(Number.isFinite(Date.parse(String(actual.updatedAt))), 'updatedAt is a valid timestamp')
}

test.group('M2b full-fixture HTTP persistence', (group) => {
  group.setup(() => testUtils.db().migrate())

  test('account: every field round-trips, including optional scheduling mode', async ({
    client,
  }) => {
    await resetEmpty(client)
    await write(client, [put('accounts', FIXTURE_ACCOUNT)])
    assertFixture(row(await state(client), 'accounts', FIXTURE_ACCOUNT.id), FIXTURE_ACCOUNT)
  })

  test('ordinary client: every field round-trips with lifecycle timestamps omitted on create', async ({
    client,
  }) => {
    await resetEmpty(client)
    const expected = stripLifecycle(FIXTURE_CLIENT)
    await write(client, [put('accounts', FIXTURE_ACCOUNT), put('clients', expected)])
    assertFixture(row(await state(client), 'clients', expected.id), expected)
  })

  test('discipline: every field round-trips, including optional color', async ({ client }) => {
    await resetEmpty(client)
    await write(client, [put('accounts', FIXTURE_ACCOUNT), put('disciplines', FIXTURE_DISCIPLINE)])
    assertFixture(
      row(await state(client), 'disciplines', FIXTURE_DISCIPLINE.id),
      FIXTURE_DISCIPLINE
    )
  })

  test('project: every field round-trips with lifecycle timestamps omitted on create', async ({
    client,
  }) => {
    await resetEmpty(client)
    const expected = stripLifecycle(FIXTURE_PROJECT)
    await write(client, [
      put('accounts', FIXTURE_ACCOUNT),
      put('clients', stripLifecycle(FIXTURE_CLIENT)),
      put('projects', expected),
    ])
    assertFixture(row(await state(client), 'projects', expected.id), expected)
  })

  test('phase: every field round-trips', async ({ client }) => {
    await resetEmpty(client)
    await write(client, [...dependencies()])
    assertFixture(row(await state(client), 'phases', FIXTURE_PHASE.id), FIXTURE_PHASE)
  })

  test('placeholder resource: every field round-trips with optional fields and JSON weekdays', async ({
    client,
  }) => {
    await resetEmpty(client)
    const expected = stripLifecycle(FIXTURE_RESOURCE)
    await write(client, [...dependencies().slice(0, 4), put('resources', expected)])
    assertFixture(row(await state(client), 'resources', expected.id), expected)
  })

  test('supplementary engagement persists independently of permanent employment', async ({
    client,
  }) => {
    await resetEmpty(client)
    const supplementary = {
      ...FIXTURE_RESOURCE_PERSON,
      id: 'fix-r-supplementary',
      name: 'Selina Kyle',
      employmentType: 'permanent' as const,
      engagement: 'supplementary' as const,
      archivedAt: null,
      deletedAt: null,
    }
    await write(client, [...dependencies().slice(0, 4), put('resources', supplementary)])
    const saved = row(await state(client), 'resources', supplementary.id)
    assert.deepEqual(
      { employmentType: saved.employmentType, engagement: saved.engagement },
      { employmentType: 'permanent', engagement: 'supplementary' }
    )
  })

  test('person resource: every field round-trips with availability boundaries', async ({
    client,
  }) => {
    await resetEmpty(client)
    const expected = stripLifecycle(FIXTURE_RESOURCE_PERSON)
    await write(client, [...dependencies().slice(0, 4), put('resources', expected)])
    assertFixture(row(await state(client), 'resources', expected.id), expected)
  })

  test('external resource: kind and company name round-trip without discipline or project binding', async ({
    client,
  }) => {
    await resetEmpty(client)
    await write(client, [
      ...dependencies().slice(0, 4),
      put('resources', FIXTURE_RESOURCE_EXTERNAL),
    ])
    assertFixture(
      row(await state(client), 'resources', FIXTURE_RESOURCE_EXTERNAL.id),
      FIXTURE_RESOURCE_EXTERNAL
    )
  })

  test('project activity: every field round-trips, including project and phase attribution', async ({
    client,
  }) => {
    await resetEmpty(client)
    await write(client, [...dependencies(), put('activities', FIXTURE_ACTIVITY)])
    assertFixture(row(await state(client), 'activities', FIXTURE_ACTIVITY.id), FIXTURE_ACTIVITY)
  })

  test('internal and repeatable activities round-trip without project or phase attribution', async ({
    client,
  }) => {
    await resetEmpty(client)
    await write(client, [
      ...dependencies(),
      put('activities', FIXTURE_ACTIVITY_INTERNAL),
      put('activities', FIXTURE_ACTIVITY_REPEATABLE),
    ])
    const stored = await state(client)
    assert.equal(stored.activities.length, 2)
    assertFixture(
      row(stored, 'activities', FIXTURE_ACTIVITY_INTERNAL.id),
      FIXTURE_ACTIVITY_INTERNAL
    )
    assertFixture(
      row(stored, 'activities', FIXTURE_ACTIVITY_REPEATABLE.id),
      FIXTURE_ACTIVITY_REPEATABLE
    )
  })

  test('allocations round-trip both without and with optional project attribution', async ({
    client,
  }) => {
    await resetEmpty(client)
    await write(client, [
      ...dependencies(),
      put('resources', stripLifecycle(FIXTURE_RESOURCE)),
      put('activities', FIXTURE_ACTIVITY),
      put('activities', FIXTURE_ACTIVITY_REPEATABLE),
      put('allocations', FIXTURE_ALLOCATION),
      put('allocations', FIXTURE_ALLOCATION_ATTRIBUTED),
    ])
    const stored = await state(client)
    assert.equal(stored.allocations.length, 2)
    assertFixture(row(stored, 'allocations', FIXTURE_ALLOCATION.id), FIXTURE_ALLOCATION)
    assertFixture(
      row(stored, 'allocations', FIXTURE_ALLOCATION_ATTRIBUTED.id),
      FIXTURE_ALLOCATION_ATTRIBUTED
    )
  })

  test('time off: every field round-trips, including optional note', async ({ client }) => {
    await resetEmpty(client)
    await write(client, [
      ...dependencies().slice(0, 4),
      put('resources', stripLifecycle(FIXTURE_RESOURCE)),
      put('timeOff', FIXTURE_TIMEOFF),
    ])
    assertFixture(row(await state(client), 'timeOff', FIXTURE_TIMEOFF.id), FIXTURE_TIMEOFF)
  })
})
