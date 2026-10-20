import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { Bouncer } from '@adonisjs/bouncer'
import { canSeePrivateNames, canSeeTimeOffNote } from '@capacitylens/shared/domain/access'
import { APP_DATA_KEYS, type AppDataKey } from '@capacitylens/shared/types/entities'
import DataPolicy from '#policies/data_policy'
import { applyBatch } from '#services/batch/service'
import {
  trustedLocalDataContext,
  type BatchDataContext,
  type BatchCapabilities,
} from '#services/batch/data_policy'
import { readStateWithClient, replaceWithSeed } from '#services/state_repository'
import { withTransaction } from '#services/with_transaction'
import { applyLifecycle } from '#services/lifecycle'
import { BatchStateProjection } from '#services/batch/projection'

function context(role: BatchCapabilities['role']): BatchDataContext {
  const capabilities: BatchCapabilities = {
    role,
    canWrite: role !== 'viewer',
    canPurge: role === 'owner' || role === 'admin',
    canSeePrivateNames: canSeePrivateNames(role),
    canSeeTimeOffNote: canSeeTimeOffNote(role),
  }
  const bouncer = new Bouncer({ id: 'bruce-wayne' })
  return {
    ...trustedLocalDataContext('bruce-wayne'),
    ...capabilities,
    capabilitiesFor: () => capabilities,
    authorize: (accountId, action, resolved) =>
      bouncer.with(DataPolicy).allows(action, { accountId, capabilities: resolved }),
  }
}

async function state() {
  return readStateWithClient(db.connection(), undefined, true)
}

async function put(table: AppDataKey, row: Record<string, unknown>, actor = context('owner')) {
  return withTransaction((trx) =>
    applyBatch(trx, [{ method: 'PUT', table, id: String(row.id), row }], null, actor)
  )
}

function rowFor(data: Awaited<ReturnType<typeof state>>, table: AppDataKey, id?: string) {
  const row = id
    ? data[table].find((candidate) => candidate.id === id)
    : data[table].find((candidate) =>
        table === 'accounts'
          ? candidate.id === 'a-studio'
          : 'accountId' in candidate &&
            candidate.accountId === 'a-studio' &&
            (table !== 'clients' || !('builtin' in candidate) || candidate.builtin !== true)
      )
  if (!row && table === 'closures' && id === undefined)
    return {
      id: 'm2a-closure-template',
      accountId: 'a-studio',
      name: 'Wayne Enterprises anniversary',
      startDate: '2026-06-15',
      endDate: '2026-06-15',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
  if (!row) throw new Error(`Missing test row in ${table}.`)
  return row as unknown as Record<string, unknown>
}

test.group('M2a CRUD and field policy contracts', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(() => replaceWithSeed())

  test('round-trips a full create and update for every product entity', async ({ assert }) => {
    for (const table of APP_DATA_KEYS) {
      const base = rowFor(await state(), table)
      const id = `m2a-crud-${table}`
      const created = await put(table, {
        ...base,
        id,
      })
      assert.equal(created.applied, 1)
      assert.equal(created.changed, 1)
      let stored = rowFor(await state(), table, id)
      const field = table === 'allocations' || table === 'timeOff' ? 'note' : 'name'
      const value =
        table === 'accounts'
          ? 'Wayne Foundation'
          : table === 'resources'
            ? 'Clark Kent'
            : table === 'clients'
              ? 'Wayne Foundation'
              : table === 'projects'
                ? 'Justice League Watchtower'
                : 'Updated scheduling detail'
      const updated = await put(table, {
        ...stored,
        [field]: value,
        createdAt: '2099-01-01T00:00:00.000Z',
      })
      assert.equal(updated.revisions.length, 1)
      stored = rowFor(await state(), table, id)
      assert.equal(stored[field], value)
      assert.equal(stored.createdAt, created.revisions[0]?.createdAt)
      assert.isAbove(
        Date.parse(String(stored.updatedAt)),
        Date.parse(String(created.revisions[0]?.updatedAt))
      )
    }
  })

  test('deletes ordinary rows once and counts a repeated missing deletion as unchanged', async ({
    assert,
  }) => {
    for (const table of ['disciplines', 'phases', 'allocations', 'timeOff', 'closures'] as const) {
      const base = rowFor(await state(), table)
      const id = `m2a-delete-${table}`
      await put(table, { ...base, id })
      const stored = rowFor(await state(), table, id)
      const op = {
        method: 'DELETE' as const,
        table,
        id,
        accountId: 'a-studio',
        updatedAt: String(stored.updatedAt),
      }
      const deleted = await withTransaction((trx) => applyBatch(trx, [op], null, context('owner')))
      assert.equal(deleted.changed, 1)
      const afterDeletion = await state()
      assert.isFalse(afterDeletion[table].some((candidate) => candidate.id === id))
      const repeated = await withTransaction((trx) => applyBatch(trx, [op], null, context('owner')))
      assert.equal(repeated.applied, 1)
      assert.equal(repeated.changed, 0)
    }
  })

  test('enforces the native role boundary without changing storage on a viewer write', async ({
    assert,
  }) => {
    const before = await state()
    const row = rowFor(before, 'disciplines')
    await assert.rejects(
      () => put('disciplines', { ...row, name: 'Rejected viewer change' }, context('viewer')),
      /Forbidden/
    )
    assert.deepEqual(await state(), before)
    for (const role of ['owner', 'admin', 'editor'] as const) {
      const current = rowFor(await state(), 'disciplines', String(row.id))
      await put('disciplines', { ...current, name: `Accepted ${role} change` }, context(role))
      assert.equal(
        rowFor(await state(), 'disciplines', String(row.id)).name,
        `Accepted ${role} change`
      )
    }
  })

  test('pins private client and project names on blind updates and strips privacy on blind creates', async ({
    assert,
  }) => {
    for (const table of ['clients', 'projects'] as const) {
      const base = rowFor(await state(), table)
      const id = `m2a-private-${table}`
      await put(table, {
        ...base,
        id,
        name: table === 'clients' ? 'Wayne Foundation' : 'Justice League Watchtower',
        isPrivate: true,
        codeName: 'Project Batman',
      })
      const before = rowFor(await state(), table, id)
      await put(
        table,
        {
          ...before,
          name: 'Attempted hidden replacement',
          isPrivate: false,
          codeName: 'Attempted code replacement',
          color: '#5c34d4',
        },
        context('editor')
      )
      const stored = rowFor(await state(), table, id)
      assert.equal(stored.name, before.name)
      assert.equal(stored.isPrivate, true)
      assert.equal(stored.codeName, 'Project Batman')
      assert.equal(stored.color, '#5c34d4')
      const publicId = `m2a-public-${table}`
      await put(
        table,
        { ...base, id: publicId, isPrivate: true, codeName: 'Attempted hidden creation' },
        context('editor')
      )
      const publicRow = rowFor(await state(), table, publicId)
      assert.isNull(publicRow.isPrivate)
      assert.isNull(publicRow.codeName)
    }
  })

  test('pins an unseen time-off note on update and strips it on creation', async ({ assert }) => {
    const base = rowFor(await state(), 'timeOff')
    const id = 'm2a-private-time-off'
    await put('timeOff', { ...base, id, note: 'Private appointment detail' })
    const stored = rowFor(await state(), 'timeOff', id)
    await put('timeOff', { ...stored, note: 'Attempted hidden replacement' }, context('editor'))
    assert.equal(rowFor(await state(), 'timeOff', id).note, 'Private appointment detail')
    await put(
      'timeOff',
      { ...base, id: 'm2a-public-time-off', note: 'Attempted hidden creation' },
      context('editor')
    )
    assert.isNull(rowFor(await state(), 'timeOff', 'm2a-public-time-off').note)
  })

  test('redacts private-name conflict echoes and preserves the current row', async ({ assert }) => {
    const base = rowFor(await state(), 'clients')
    await put('clients', {
      ...base,
      id: 'm2a-conflict-private',
      name: 'Wayne Foundation',
      isPrivate: true,
      codeName: 'Project Batman',
    })
    const before = rowFor(await state(), 'clients', 'm2a-conflict-private')
    let failure: unknown
    try {
      await put(
        'clients',
        { ...before, updatedAt: '2000-01-01T00:00:00.000Z', name: 'Attempted stale replacement' },
        context('editor')
      )
    } catch (error) {
      failure = error
    }
    assert.isDefined(failure)
    const current = (failure as { current?: Record<string, unknown> }).current
    assert.equal(current?.name, '"Project Batman"')
    assert.isNull(current!.codeName)
    assert.notInclude(JSON.stringify(current), 'Wayne Foundation')
    assert.deepEqual(rowFor(await state(), 'clients', 'm2a-conflict-private'), before)
  })

  test('repeated fresh-revision PUTs overwrite one identity while stale ordinary replay remains rejected', async ({
    assert,
  }) => {
    const base = rowFor(await state(), 'clients')
    const id = 'm2a-upsert-identity'
    const original = { ...base, id, name: 'Wayne Foundation' }
    await put('clients', original)
    const first = rowFor(await state(), 'clients', id)
    await put('clients', { ...first })
    const second = rowFor(await state(), 'clients', id)
    assert.equal(second.name, first.name)
    assert.equal(second.createdAt, first.createdAt)
    const data = await state()
    assert.lengthOf(
      data.clients.filter((row) => row.id === id),
      1
    )
    await assert.rejects(() => put('clients', original), /modified more recently/)
    assert.deepEqual(rowFor(await state(), 'clients', id), second)
  })

  test('writes one lifecycle product row without rewriting tenant siblings', async ({ assert }) => {
    const before = await readStateWithClient(db.connection(), 'a-loft', true)
    await db.rawQuery(
      'CREATE TEMP TABLE m2a_lifecycle_writes (operation TEXT, table_name TEXT, row_id TEXT)'
    )
    const triggerNames: string[] = []
    try {
      for (const table of APP_DATA_KEYS.filter((key) => key !== 'accounts')) {
        const physicalTable = table === 'timeOff' ? 'time_off' : table
        for (const operation of ['insert', 'update', 'delete'] as const) {
          const name = `m2a_trace_${table}_${operation}`
          const reference = operation === 'delete' ? 'OLD' : 'NEW'
          await db.rawQuery(
            `CREATE TEMP TRIGGER ${name} AFTER ${operation.toUpperCase()} ON ${physicalTable} BEGIN INSERT INTO m2a_lifecycle_writes VALUES ('${operation}','${table}',${reference}.id); END`
          )
          triggerNames.push(name)
        }
      }
      await withTransaction((trx) =>
        applyLifecycle(trx, 'resources', 'r-tyler', 'a-studio', 'archive', context('owner'))
      )
      assert.deepEqual(await db.from('m2a_lifecycle_writes').select('*'), [
        { operation: 'update', table_name: 'resources', row_id: 'r-tyler' },
      ])
      assert.deepEqual(await readStateWithClient(db.connection(), 'a-loft', true), before)
    } finally {
      for (const name of triggerNames) await db.rawQuery(`DROP TRIGGER ${name}`)
      await db.rawQuery('DROP TABLE m2a_lifecycle_writes')
    }
  })

  test('keeps indexed mutation predicates scoped to the requested company', async ({ assert }) => {
    const data = await state()
    const loaded = data.allocations.find(
      (row) => row.accountId === 'a-studio' && row.hoursPerDay !== 0
    )!
    const timeOff = data.timeOff.find((row) => row.accountId === 'a-studio')!
    const projection = new BatchStateProjection(data)
    assert.isTrue(projection.resourceHasLoadedAllocation('a-studio', loaded.resourceId))
    assert.isFalse(projection.resourceHasLoadedAllocation('a-loft', loaded.resourceId))
    assert.isTrue(projection.resourceHasTimeOff('a-studio', timeOff.resourceId))
    assert.isFalse(projection.resourceHasTimeOff('a-loft', timeOff.resourceId))
    assert.isEmpty(projection.allocationsForResource('a-loft', loaded.resourceId))
    assert.isEmpty(projection.allocationsForActivity('a-loft', loaded.activityId))
    for (const row of [...projection.allocationsForResource('a-studio', loaded.resourceId)]) {
      projection.upsert('allocations', { ...row, hoursPerDay: 0 })
    }
    assert.isFalse(projection.resourceHasLoadedAllocation('a-studio', loaded.resourceId))
  })
})
