import { test } from '@japa/runner'
import { freshDatabase } from '../../helpers/fresh_database.js'
import db from '@adonisjs/lucid/services/db'
import type { BatchRevision } from '#services/batch/types'
import { batch, readStudioState, resetSeedClient, studioSeed } from './ordering_helpers.js'

const SESSION = 'm2a-ordering-session-01'

function revisions(response: { body(): unknown }) {
  const value = response.body() as { revisions?: BatchRevision[] }
  if (!Array.isArray(value.revisions)) throw new Error('Expected batch revision receipts.')
  return value.revisions
}

test.group('M2a ordered batch behavior', (group) => {
  group.setup(() => freshDatabase())

  test('accepts the exact same-session successor row hash and advances revisions monotonically', async ({
    client,
    assert,
  }) => {
    client = await resetSeedClient(client)
    const { data } = studioSeed()
    const current = data.disciplines[0]!
    const first = await batch(
      client,
      [
        {
          method: 'PUT',
          table: 'disciplines',
          id: current.id,
          row: { ...current, name: 'First edit' },
        },
      ],
      { sessionId: SESSION, sequence: 1 }
    )
    first.assertStatus(200)
    const firstRevision = revisions(first)[0]!.updatedAt
    const successor = await batch(
      client,
      [
        {
          method: 'PUT',
          table: 'disciplines',
          id: current.id,
          row: { ...current, name: 'Newest edit' },
        },
      ],
      { sessionId: SESSION, sequence: 2 }
    )
    successor.assertStatus(200)
    const successorRevision = revisions(successor)[0]!.updatedAt
    assert.isAbove(Date.parse(successorRevision), Date.parse(firstRevision))
    const finalState = await readStudioState(client)
    assert.equal(finalState.disciplines[0]?.name, 'Newest edit')
  })

  test('a higher sequence received first supersedes a later-arriving older write', async ({
    client,
    assert,
  }) => {
    client = await resetSeedClient(client)
    const current = studioSeed().data.disciplines[0]!
    const newest = await batch(
      client,
      [
        {
          method: 'PUT',
          table: 'disciplines',
          id: current.id,
          row: { ...current, name: 'Newest' },
        },
      ],
      { sessionId: 'm2a-ordering-session-02', sequence: 2 }
    )
    newest.assertStatus(200)
    const older = await batch(
      client,
      [{ method: 'PUT', table: 'disciplines', id: current.id, row: { ...current, name: 'Older' } }],
      { sessionId: 'm2a-ordering-session-02', sequence: 1 }
    )
    older.assertStatus(200)
    older.assertBodyContains({ superseded: true, applied: 1, changed: 0 })
    const finalState = await readStudioState(client)
    assert.equal(finalState.disciplines[0]?.name, 'Newest')
  })

  test('an external edit invalidates the successor hash and remains stored', async ({ client }) => {
    client = await resetSeedClient(client)
    const disciplines = studioSeed().data.disciplines
    const original = disciplines[0]!
    const sibling = disciplines.find((row) => row.id !== original.id)!
    const first = await batch(
      client,
      [
        {
          method: 'PUT',
          table: 'disciplines',
          id: original.id,
          row: { ...original, name: 'First' },
        },
      ],
      { sessionId: 'm2a-ordering-session-03', sequence: 1 }
    )
    first.assertStatus(200)
    const stateAfterFirst = await readStudioState(client)
    const afterFirst = stateAfterFirst.disciplines.find((row) => row.id === original.id)!
    const external = await batch(client, [
      {
        method: 'PUT',
        table: 'disciplines',
        id: original.id,
        row: { ...afterFirst, name: 'External edit' },
      },
    ])
    external.assertStatus(200)
    const successor = await batch(
      client,
      [
        {
          method: 'PUT',
          table: 'disciplines',
          id: sibling.id,
          row: { ...sibling, name: 'Must roll back with stale PUT' },
        },
        {
          method: 'PUT',
          table: 'disciplines',
          id: original.id,
          row: { ...original, name: 'Newest' },
        },
      ],
      { sessionId: 'm2a-ordering-session-03', sequence: 2 }
    )
    successor.assertStatus(409)
    successor.assertBodyContains({ error: 'The record was modified more recently on the server.' })
    const state = await readStudioState(client)
    if (!state.disciplines.some((row) => row.id === original.id && row.name === 'External edit')) {
      throw new Error('The external edit was not preserved after stale successor rejection.')
    }
    const storedSibling = state.disciplines.find((row) => row.id === sibling.id)
    if (storedSibling?.name !== sibling.name) {
      throw new Error(
        `Sibling PUT state mismatch after stale rejection: ${JSON.stringify({
          id: sibling.id,
          expectedName: sibling.name,
          actualName: storedSibling?.name,
        })}`
      )
    }
  })

  test('a stale DELETE rolls back earlier operations and preserves the external row', async ({
    client,
    assert,
  }) => {
    client = await resetSeedClient(client)
    const initial = studioSeed().data
    const allocation = initial.allocations[0]!
    const discipline = initial.disciplines[0]!
    const external = await batch(client, [
      {
        method: 'PUT',
        table: 'allocations',
        id: allocation.id,
        row: { ...allocation, note: 'External edit' },
      },
    ])
    external.assertStatus(200)
    const stale = await batch(
      client,
      [
        {
          method: 'PUT',
          table: 'disciplines',
          id: discipline.id,
          row: { ...discipline, name: 'Must roll back' },
        },
        {
          method: 'DELETE',
          table: 'allocations',
          id: allocation.id,
          accountId: allocation.accountId,
          updatedAt: allocation.updatedAt,
        },
      ],
      { sessionId: 'm2a-stale-delete-session', sequence: 1 }
    )
    stale.assertStatus(409)
    const state = await readStudioState(client)
    assert.equal(state.disciplines.find((row) => row.id === discipline.id)?.name, discipline.name)
    assert.equal(state.allocations.find((row) => row.id === allocation.id)?.note, 'External edit')
  })

  test('a stale ARCHIVE rejects without changing the externally edited row', async ({ client }) => {
    client = await resetSeedClient(client)
    const original = studioSeed().data.clients.find((row) => row.id === 'c-acme')!
    const external = await batch(client, [
      {
        method: 'PUT',
        table: 'clients',
        id: original.id,
        row: { ...original, name: 'External client edit' },
      },
    ])
    external.assertStatus(200)
    const stale = await batch(
      client,
      [
        {
          method: 'ARCHIVE',
          table: 'clients',
          id: original.id,
          accountId: original.accountId,
          updatedAt: original.updatedAt,
        },
      ],
      { sessionId: 'm2a-stale-archive-session', sequence: 1 }
    )
    stale.assertStatus(409)
    const finalState = await readStudioState(client)
    const stored = finalState.clients.find((row) => row.id === original.id)
    if (!stored || stored.name !== 'External client edit' || stored.archivedAt) {
      throw new Error('The stale archive changed the externally edited client.')
    }
  })

  test('ordered ARCHIVE retains its inactive row and fences an older creation', async ({
    client,
  }) => {
    client = await resetSeedClient(client)
    const original = studioSeed().data.clients.find((row) => row.id === 'c-acme')!
    const archived = await batch(
      client,
      [
        {
          method: 'ARCHIVE',
          table: 'clients',
          id: original.id,
          accountId: original.accountId,
          updatedAt: original.updatedAt,
        },
      ],
      { sessionId: 'm2a-archive-session', sequence: 2 }
    )
    archived.assertStatus(200)
    const staleWrite = await batch(
      client,
      [{ method: 'PUT', table: 'clients', id: original.id, row: original }],
      { sessionId: 'm2a-archive-session', sequence: 1 }
    )
    staleWrite.assertStatus(200)
    staleWrite.assertBodyContains({ superseded: true })
    const finalState = await readStudioState(client)
    const stored = finalState.clients.find((row) => row.id === original.id)
    if (!stored || typeof stored.archivedAt !== 'string') {
      throw new Error('The archived row was removed or resurrected.')
    }
  })

  test('an ordered non-lifecycle DELETE prevents an older creation from being resurrected', async ({
    client,
  }) => {
    client = await resetSeedClient(client)
    const base = studioSeed().data.disciplines[0]!
    const temporary = { ...base, id: 'm2a-temporary-discipline', name: 'Temporary' }
    const deleted = await batch(
      client,
      [
        {
          method: 'DELETE',
          table: 'disciplines',
          id: temporary.id,
          accountId: temporary.accountId,
          updatedAt: temporary.updatedAt,
        },
      ],
      { sessionId: 'm2a-delete-session', sequence: 2 }
    )
    deleted.assertStatus(200)
    const olderCreate = await batch(
      client,
      [{ method: 'PUT', table: 'disciplines', id: temporary.id, row: temporary }],
      { sessionId: 'm2a-delete-session', sequence: 1 }
    )
    olderCreate.assertStatus(200)
    olderCreate.assertBodyContains({ superseded: true })
    const finalState = await readStudioState(client)
    if (finalState.disciplines.some((row) => row.id === temporary.id)) {
      throw new Error('The older creation resurrected a deleted row.')
    }
  })

  test('ordered sessions and row provenance expire after seven days', async ({
    client,
    assert,
  }) => {
    client = await resetSeedClient(client)
    const row = studioSeed().data.disciplines[0]!
    const recorded = await batch(
      client,
      [{ method: 'PUT', table: 'disciplines', id: row.id, row: { ...row, name: 'Ordered' } }],
      { sessionId: 'm2a-expiry-session', sequence: 1 }
    )
    recorded.assertStatus(200)
    const stateBeforeExpiry = await readStudioState(client)
    const current = stateBeforeExpiry.disciplines.find((item) => item.id === row.id)!
    await db
      .from('capacitylens_sync_sessions')
      .where('session_id', 'm2a-expiry-session')
      .update({ updated_at: '2000-01-01T00:00:00.000Z' })
    const triggerCleanup = await batch(
      client,
      [
        {
          method: 'PUT',
          table: 'disciplines',
          id: row.id,
          row: { ...current, name: 'Next session' },
        },
      ],
      { sessionId: 'm2a-cleanup-session', sequence: 1 }
    )
    triggerCleanup.assertStatus(200)
    const expiredSession = await db
      .from('capacitylens_sync_sessions')
      .where('session_id', 'm2a-expiry-session')
      .first()
    assert.isNull(expiredSession)
  })
})
