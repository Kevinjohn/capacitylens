import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import { freshDatabase } from '../../helpers/fresh_database.js'
import db from '@adonisjs/lucid/services/db'
import { seed } from '@capacitylens/shared/data/seed'
import type { AppData } from '@capacitylens/shared/types/entities'
import { applyLifecycle } from '#services/lifecycle'
import { trustedLocalDataContext } from '#services/batch/data_policy'
import { withTransaction } from '#services/with_transaction'

const TS = '2026-01-01T00:00:00.000Z'
const AGED = '2000-01-01T00:00:00.000Z'
const FUTURE_REVISION = '2099-01-01T00:00:00.000Z'
const trusted = <T extends { header(name: string, value: string): T }>(request: T) =>
  request.header('sec-fetch-site', 'same-origin')

async function reset(client: ApiClient) {
  const response = await client.post('/api/test/reset').json({ seed: true }).send()
  response.assertStatus(200)
}

async function state(client: ApiClient, inactive = false) {
  const response = await client
    .get(`/api/state?accountId=a-studio${inactive ? '&includeInactive=1' : ''}`)
    .send()
  response.assertStatus(200)
  return response.body() as AppData
}

function lifecycle(
  client: ApiClient,
  entity: string,
  id: string,
  action: string,
  accountId = 'a-studio'
) {
  return trusted(client.post(`/api/${entity}/${id}/${action}`))
    .json({ accountId })
    .send()
}

function batch(client: ApiClient, ops: unknown[]) {
  return trusted(client.post('/api/batch'))
    .json({ ops } as never)
    .send()
}

async function stored(table: string, id: string) {
  const row = await db.from(table).where('id', id).first()
  if (!row) throw new Error(`Expected persisted ${table} row ${id}.`)
  return row as Record<string, unknown>
}

function details(row: Record<string, unknown>) {
  const value = row.details
  return (typeof value === 'string' ? JSON.parse(value) : value) as Record<string, unknown>
}

test.group('M2a lifecycle contract', (group) => {
  group.setup(() => freshDatabase())

  test('keeps transition refusals exact and leaves every refused row unchanged', async ({
    client,
    assert,
  }) => {
    await reset(client)
    const attempts = [
      {
        table: 'resources',
        id: 'r-tyler',
        action: 'delete',
        persistedTable: 'resources',
        setup: async () => {},
        code: 'invalid_transition',
        error: 'Cannot delete: entity must be archived first (is active).',
      },
      {
        table: 'clients',
        id: 'c-acme',
        action: 'archive',
        persistedTable: 'clients',
        setup: () => db.from('clients').where('id', 'c-acme').update({ archived_at: TS }),
        code: 'already_inactive',
        error: 'Cannot archive: entity is already archived.',
      },
      {
        table: 'clients',
        id: 'c-globex',
        action: 'unarchive',
        persistedTable: 'clients',
        setup: async () => {},
        code: 'invalid_transition',
        error: 'Cannot unarchive: entity is active, not archived.',
      },
      {
        table: 'clients',
        id: 'c-globex',
        action: 'purge',
        persistedTable: 'clients',
        setup: () => db.from('clients').where('id', 'c-globex').update({ archived_at: TS }),
        code: undefined,
        error: 'Cannot purge: must be a soft-deleted tombstone at least 30 days old.',
      },
      {
        table: 'resources',
        id: 'r-nike',
        action: 'purge',
        persistedTable: 'resources',
        setup: () =>
          db.from('resources').where('id', 'r-nike').update({
            archived_at: TS,
            deleted_at: new Date().toISOString(),
          }),
        code: undefined,
        error: 'Cannot purge: must be a soft-deleted tombstone at least 30 days old.',
      },
      {
        table: 'projects',
        id: 'p-acme',
        action: 'unarchive',
        persistedTable: 'projects',
        setup: () =>
          db.from('projects').where('id', 'p-acme').update({ archived_at: TS, deleted_at: AGED }),
        code: 'invalid_transition',
        error: 'Cannot unarchive: entity is deleted, not archived.',
      },
      {
        table: 'resources',
        id: 'r-alex',
        action: 'delete',
        persistedTable: 'resources',
        setup: () =>
          db.from('resources').where('id', 'r-alex').update({ archived_at: TS, deleted_at: AGED }),
        code: 'invalid_transition',
        error: 'Cannot delete: entity must be archived first (is deleted).',
      },
    ] as const

    for (const attempt of attempts) {
      await attempt.setup()
      const before = await stored(attempt.persistedTable, attempt.id)
      const response = await lifecycle(client, attempt.table, attempt.id, attempt.action)
      response.assertStatus(409)
      assert.deepEqual(response.body(), {
        ...(attempt.code ? { code: attempt.code } : {}),
        error: attempt.error,
      })
      assert.deepEqual(await stored(attempt.persistedTable, attempt.id), before)
    }
  })

  test('returns the lifecycle 400/404 contract without exposing another account row', async ({
    client,
    assert,
  }) => {
    await reset(client)
    const unknown = await lifecycle(client, 'phases', 'missing', 'archive')
    unknown.assertStatus(404)
    assert.deepEqual(unknown.body(), { error: 'Unknown entity: phases.' })

    const missingAccount = await trusted(client.post('/api/clients/c-acme/archive')).json({}).send()
    missingAccount.assertStatus(400)
    assert.deepEqual(missingAccount.body(), {
      error: 'The accountId field must be defined',
      code: 'VALIDATION_ERROR',
    })

    const missingRow = await lifecycle(client, 'clients', 'does-not-exist', 'archive')
    missingRow.assertStatus(404)
    assert.deepEqual(missingRow.body(), { error: 'Not found.' })

    const wrongScope = await lifecycle(client, 'clients', 'c-loft-northwind', 'archive', 'a-studio')
    wrongScope.assertStatus(404)
    assert.deepEqual(wrongScope.body(), { error: 'Not found.' })
    const foreign = await db.from('clients').where('id', 'c-loft-northwind').first()
    assert.exists(foreign)
    assert.isNull(foreign.archived_at)
  })

  test('protects the generated Internal client from every lifecycle verb', async ({
    client,
    assert,
  }) => {
    await reset(client)
    const internal = seed().clients.find((row) => row.id === 'c-internal-studio')
    assert.exists(internal)
    for (const [action, verb] of [
      ['archive', 'archived'],
      ['delete', 'deleted'],
      ['purge', 'purged'],
    ] as const) {
      const before = await stored('clients', internal!.id)
      const response = await lifecycle(client, 'clients', internal!.id, action)
      response.assertStatus(409)
      assert.deepEqual(response.body(), {
        code: 'protected_entity',
        error: `The built-in Internal client cannot be ${verb}.`,
      })
      assert.deepEqual(await stored('clients', internal!.id), before)
    }
  })

  test('redacts private client values from an editor-equivalent archive result', async ({
    client,
    assert,
  }) => {
    await reset(client)
    const current = seed().clients.find((row) => row.id === 'c-acme')!
    const realName = 'PRIVATE_ARCHIVE_RESPONSE_7TQ'
    const codeName = 'Blue Beetle'
    await db
      .from('clients')
      .where('id', current.id)
      .update({ name: realName, code_name: codeName, is_private: JSON.stringify(true) })
    const base = trustedLocalDataContext('editor-private-name')
    const capabilities = {
      ...base.capabilitiesFor(current.accountId),
      role: 'editor' as const,
      canPurge: false,
      canSeePrivateNames: false,
    }
    const context = { ...base, ...capabilities, capabilitiesFor: () => capabilities }
    const result = await withTransaction((trx) =>
      applyLifecycle(trx, 'clients', current.id, current.accountId, 'archive', context)
    )

    const persisted = await stored('clients', current.id)
    assert.isNotNull(persisted.archived_at)
    assert.exists(result)
    assert.notEqual((result as Record<string, unknown>).name, realName)
    assert.isNull((result as Record<string, unknown>).codeName)
    assert.equal(persisted.name, realName)
  })

  test('persists unarchive as active and keeps inactive activities out of normal projections', async ({
    client,
    assert,
  }) => {
    await reset(client)
    const activity = seed().activities.find((row) => row.id === 't-wires')!
    const archive = await lifecycle(client, 'activities', activity.id, 'archive')
    archive.assertStatus(200)
    const archivedDbRow = await stored('activities', activity.id)
    assert.isString(archivedDbRow.archived_at)
    const activeBeforeRestore = await state(client)
    assert.notInclude(
      activeBeforeRestore.activities.map((row) => row.id),
      activity.id
    )
    const inactiveBeforeRestore = await state(client, true)
    assert.include(
      inactiveBeforeRestore.activities.map((row) => row.id),
      activity.id
    )
    assert.include(
      inactiveBeforeRestore.allocations.map((row) => row.id),
      'a-tyler-1'
    )

    const restore = await lifecycle(client, 'activities', activity.id, 'unarchive')
    restore.assertStatus(200)
    const restoredDbRow = await stored('activities', activity.id)
    assert.isNull(restoredDbRow.archived_at)
    const activeAfterRestore = await state(client)
    assert.include(
      activeAfterRestore.activities.map((row) => row.id),
      activity.id
    )
    assert.include(
      activeAfterRestore.allocations.map((row) => row.id),
      'a-tyler-1'
    )

    const archiveAgain = await lifecycle(client, 'activities', activity.id, 'archive')
    archiveAgain.assertStatus(200)
    const deleteResponse = await lifecycle(client, 'activities', activity.id, 'delete')
    deleteResponse.assertStatus(200)
    const deletedState = await state(client, true)
    assert.isString(deletedState.activities.find((row) => row.id === activity.id)?.deletedAt)
    assert.include(
      deletedState.allocations.map((row) => row.id),
      'a-tyler-1'
    )
    await db.from('activities').where('id', activity.id).update({ deleted_at: AGED })
    const purge = await lifecycle(client, 'activities', activity.id, 'purge')
    purge.assertStatus(204)
    const afterPurge = await state(client, true)
    assert.notInclude(
      afterPurge.activities.map((row) => row.id),
      activity.id
    )
    assert.notInclude(
      afterPurge.allocations.map((row) => row.id),
      'a-tyler-1'
    )
  })

  test('repairs a malformed deletion marker while unarchiving an archived legacy row', async ({
    client,
    assert,
  }) => {
    await reset(client)
    await db
      .from('resources')
      .where('id', 'r-tyler')
      .update({ archived_at: TS, deleted_at: 'not-a-date' })

    const response = await lifecycle(client, 'resources', 'r-tyler', 'unarchive')
    response.assertStatus(200)
    const persisted = await stored('resources', 'r-tyler')
    assert.isNull(persisted.archived_at)
    assert.isNull(persisted.deleted_at)
  })

  test('keeps the delete revision at or after a future archive timestamp', async ({
    client,
    assert,
  }) => {
    await reset(client)
    const futureArchive = '2099-01-01T00:00:00.000Z'
    await db
      .from('resources')
      .where('id', 'r-tyler')
      .update({ archived_at: futureArchive, updated_at: TS })

    const response = await lifecycle(client, 'resources', 'r-tyler', 'delete')
    response.assertStatus(200)
    const persisted = await stored('resources', 'r-tyler')
    assert.isAtLeast(Date.parse(String(persisted.updated_at)), Date.parse(futureArchive))
    assert.isAtLeast(Date.parse(String(persisted.deleted_at)), Date.parse(futureArchive))
  })

  test('archives only its target and preserves unrelated tombstones and time-off notes', async ({
    client,
    assert,
  }) => {
    await reset(client)
    const note = 'PRESERVE_LIFECYCLE_NOTE_7TQ'
    await db.from('resources').where('id', 'r-nike').update({ archived_at: TS })
    await db.from('resources').where('id', 'r-alex').update({ archived_at: TS, deleted_at: AGED })
    await db.from('time_off').where('id', 'to-tyler').update({ note })

    const response = await lifecycle(client, 'resources', 'r-tyler', 'archive')
    response.assertStatus(200)

    const inactive = await state(client, true)
    assert.isString(inactive.resources.find((row) => row.id === 'r-nike')?.archivedAt)
    assert.equal(inactive.resources.find((row) => row.id === 'r-alex')?.deletedAt, AGED)
    assert.equal(inactive.timeOff.find((row) => row.id === 'to-tyler')?.note, note)
    const active = await state(client)
    assert.notInclude(
      active.resources.map((row) => row.id),
      'r-tyler'
    )
  })

  test('keeps omitted lifecycle state on a batch PUT and atomically refuses archived or deleted ancestry', async ({
    client,
    assert,
  }) => {
    await reset(client)
    const resource = seed().resources.find((row) => row.id === 'r-tyler')!
    const archived = await lifecycle(client, 'resources', resource.id, 'archive')
    archived.assertStatus(200)
    const archivedState = await state(client, true)
    const archivedResource = archivedState.resources.find((row) => row.id === resource.id)!
    const omittedTombstone = { ...archivedResource, role: 'Editor' } as Record<string, unknown>
    delete omittedTombstone.archivedAt
    const write = await batch(client, [
      {
        method: 'PUT',
        table: 'resources',
        id: resource.id,
        row: omittedTombstone,
      },
    ])
    write.assertStatus(200)
    const archivedResourceDb = await stored('resources', resource.id)
    assert.isString(archivedResourceDb.archived_at)
    const activeResources = await state(client)
    assert.notInclude(
      activeResources.resources.map((row) => row.id),
      resource.id
    )

    await reset(client)
    const project = seed().projects.find((row) => row.id === 'p-acme')!
    const phase = seed().phases.find((row) => row.id === 'ph-disc')!
    const archivedProject = await lifecycle(client, 'projects', project.id, 'archive')
    archivedProject.assertStatus(200)
    const discipline = seed().disciplines[0]!
    const rejected = await batch(client, [
      {
        method: 'PUT',
        table: 'disciplines',
        id: discipline.id,
        row: { ...discipline, name: 'Must roll back' },
      },
      { method: 'PUT', table: 'phases', id: phase.id, row: { ...phase, name: 'Hidden update' } },
    ])
    rejected.assertStatus(400)
    const activeAfterRollback = await state(client)
    const inactiveAfterRollback = await state(client, true)
    assert.equal(
      activeAfterRollback.disciplines.find((row) => row.id === discipline.id)?.name,
      discipline.name
    )
    assert.equal(inactiveAfterRollback.phases.find((row) => row.id === phase.id)?.name, phase.name)

    const archivedClient = await lifecycle(client, 'clients', 'c-globex', 'archive')
    archivedClient.assertStatus(200)
    const deletedClient = await lifecycle(client, 'clients', 'c-globex', 'delete')
    deletedClient.assertStatus(200)
    const projectUnderDeletedClient = seed().projects.find((row) => row.id === 'p-brand')!
    const descendant = await batch(client, [
      {
        method: 'PUT',
        table: 'projects',
        id: projectUnderDeletedClient.id,
        row: { ...projectUnderDeletedClient, name: 'Must remain unchanged' },
      },
    ])
    descendant.assertStatus(400)
    const stateAfterRefusal = await state(client, true)
    assert.equal(
      stateAfterRefusal.projects.find((row) => row.id === projectUnderDeletedClient.id)?.name,
      projectUnderDeletedClient.name
    )
  })

  test('scrubs deleted-resource values and writes field-only audit details', async ({
    client,
    assert,
  }) => {
    await reset(client)
    const nameSentinel = 'LIFECYCLE_PRIVATE_NAME_7TQ'
    const noteSentinel = 'LIFECYCLE_PRIVATE_NOTE_7TQ'
    await db.from('resources').where('id', 'r-tyler').update({ name: nameSentinel })
    await db
      .from('allocations')
      .where('id', 'a-tyler-1')
      .update({ note: noteSentinel, updated_at: FUTURE_REVISION })
    await db
      .from('time_off')
      .where('id', 'to-tyler')
      .update({ note: noteSentinel, updated_at: FUTURE_REVISION })

    const archived = await lifecycle(client, 'resources', 'r-tyler', 'archive')
    archived.assertStatus(200)
    const archivedAudit = await db
      .from('audit_entries')
      .where({ action: 'archive', entity: 'resources', entity_id: 'r-tyler' })
      .first()
    assert.exists(archivedAudit)
    assert.deepEqual(details(archivedAudit!).changedFields, ['archivedAt'])

    const deleted = await lifecycle(client, 'resources', 'r-tyler', 'delete')
    deleted.assertStatus(200)
    assert.notInclude(JSON.stringify(deleted.body()), nameSentinel)
    assert.notInclude(JSON.stringify(deleted.body()), noteSentinel)
    const persisted = await stored('resources', 'r-tyler')
    assert.match(String(persisted.name), /^Removed person #/)
    assert.equal(persisted.role, 'Removed resource')
    const allocation = await stored('allocations', 'a-tyler-1')
    const plainAllocation = await stored('allocations', 'a-tyler-2')
    const timeOff = await stored('time_off', 'to-tyler')
    assert.isNull(allocation.note)
    assert.equal(allocation.updated_at, '2099-01-01T00:00:00.001Z')
    assert.isNull(plainAllocation.note)
    assert.equal(
      plainAllocation.updated_at,
      seed().allocations.find((row) => row.id === 'a-tyler-2')?.updatedAt
    )
    assert.isNull(timeOff.note)
    assert.equal(timeOff.updated_at, '2099-01-01T00:00:00.001Z')

    const deleteAudit = await db
      .from('audit_entries')
      .where({ action: 'softDelete', entity: 'resources', entity_id: 'r-tyler' })
      .first()
    assert.exists(deleteAudit)
    const auditDetails = details(deleteAudit!)
    assert.deepEqual(auditDetails.changedFields, [
      'deletedAt',
      'name',
      'allocations.note',
      'timeOff.note',
    ])
    const stateBody = JSON.stringify(await state(client, true))
    const auditBody = JSON.stringify(auditDetails)
    assert.notInclude(stateBody, nameSentinel)
    assert.notInclude(stateBody, noteSentinel)
    assert.notInclude(auditBody, nameSentinel)
    assert.notInclude(auditBody, noteSentinel)
  })

  test('purges a client cascade and audits only privacy-safe per-table counts', async ({
    client,
    assert,
  }) => {
    await reset(client)
    const sentinel = 'PURGED_CLIENT_VALUE_7TQ'
    await db
      .from('clients')
      .where('id', 'c-acme')
      .update({ name: sentinel, archived_at: AGED, deleted_at: AGED })

    const response = await lifecycle(client, 'clients', 'c-acme', 'purge')
    response.assertStatus(204)
    assert.isNull(await db.from('clients').where('id', 'c-acme').first())
    assert.isNull(await db.from('projects').where('id', 'p-acme').first())
    assert.isNull(await db.from('phases').whereIn('id', ['ph-disc', 'ph-build']).first())
    assert.isNull(
      await db.from('activities').whereIn('id', ['t-wires', 't-visual', 't-cms']).first()
    )
    assert.isNotNull(await db.from('resources').where('id', 'r-tyler').first())

    const audit = await db
      .from('audit_entries')
      .where({ action: 'purge', entity: 'clients', entity_id: 'c-acme' })
      .first()
    assert.exists(audit)
    const auditDetails = details(audit!)
    assert.deepEqual(auditDetails.changedFields, [])
    assert.deepEqual(auditDetails.cascadeCounts, {
      clients: 1,
      projects: 1,
      phases: 2,
      activities: 3,
      allocations: 6,
    })
    assert.notInclude(JSON.stringify(auditDetails), sentinel)
  })
})
