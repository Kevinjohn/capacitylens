import { test } from '@japa/runner'
import { freshDatabase } from '../helpers/fresh_database.js'
import { addDaysISO } from '@capacitylens/shared/lib/dateMath'
import { seed } from '@capacitylens/shared/data/seed'
import type { AppData } from '@capacitylens/shared/types/entities'
import { batch, readStudioState, resetSeed, studioSeed, trusted } from './batch/ordering_helpers.js'

const SESSION = 'm2b-invalid-metadata-session-01'

function tableRow<K extends keyof AppData>(data: AppData, table: K, id: string) {
  const row = (data[table] as unknown as Array<Record<string, unknown>>).find(
    (candidate) => candidate.id === id
  )
  if (!row) throw new Error(`Missing ${table} row ${id}`)
  return row
}

function responseCode(response: { body(): unknown }) {
  return (response.body() as { code?: unknown }).code
}

test.group('M2b resource availability and batch pre-scan', (group) => {
  group.setup(() => freshDatabase())

  test('rejects malformed browser ordering header pairs before writes', async ({
    client,
    assert,
  }) => {
    await resetSeed(client)
    const before = await readStudioState(client)
    const malformedHeaders = [
      {
        label: 'short session id',
        headers: {
          'x-capacitylens-sync-session': 'short',
          'x-capacitylens-sync-sequence': '1',
        },
      },
      {
        label: 'zero sequence',
        headers: {
          'x-capacitylens-sync-session': 'browser-session-valid-0001',
          'x-capacitylens-sync-sequence': '0',
        },
      },
      {
        label: 'missing sequence',
        headers: { 'x-capacitylens-sync-session': 'browser-session-valid-0001' },
      },
    ]

    for (const { label, headers } of malformedHeaders) {
      const request = trusted(client.post('/api/batch'))
      for (const [name, value] of Object.entries(headers)) request.header(name, value)
      const response = await request.json({ ops: [] }).send()
      assert.equal(response.status(), 400, label)
      assert.deepEqual(response.body(), { error: 'Invalid browser sync ordering headers.' }, label)
      assert.deepEqual(await readStudioState(client), before)
    }
  })

  test('rejects non-string updatedAt in ordered PUT, DELETE, and ARCHIVE operations', async ({
    client,
    assert,
  }) => {
    await resetSeed(client)
    const before = await readStudioState(client)
    const data = seed()
    const clientRow = data.clients.find((row) => row.id === 'c-acme')!
    const discipline = data.disciplines.find((row) => row.id === 'd-design')!
    const operations = [
      {
        label: 'PUT with numeric updatedAt',
        method: 'PUT',
        table: 'clients',
        id: clientRow.id,
        row: { ...clientRow, name: 'Must not persist', updatedAt: 1 },
      },
      {
        label: 'DELETE with null updatedAt',
        method: 'DELETE',
        table: 'disciplines',
        id: discipline.id,
        accountId: discipline.accountId,
        updatedAt: null,
      },
      {
        label: 'ARCHIVE with boolean updatedAt',
        method: 'ARCHIVE',
        table: 'clients',
        id: clientRow.id,
        accountId: clientRow.accountId,
        updatedAt: false,
      },
    ]

    for (const { label, ...operation } of operations) {
      const response = await batch(client, [operation], { sessionId: SESSION, sequence: 1 })
      assert.equal(response.status(), 400, label)
      assert.deepEqual(await readStudioState(client), before)
    }
  })

  test('rejects malformed DELETE and ARCHIVE metadata during batch pre-scan', async ({
    client,
    assert,
  }) => {
    await resetSeed(client)
    const before = await readStudioState(client)
    const data = seed()
    const discipline = data.disciplines.find((row) => row.id === 'd-design')!
    const clientRow = data.clients.find((row) => row.id === 'c-acme')!
    const malformedOperations = [
      {
        label: 'DELETE with non-string accountId',
        method: 'DELETE',
        table: 'disciplines',
        id: discipline.id,
        accountId: 1,
      },
      {
        label: 'ARCHIVE on non-lifecycle table',
        method: 'ARCHIVE',
        table: 'disciplines',
        id: discipline.id,
        accountId: discipline.accountId,
      },
      {
        label: 'ARCHIVE without accountId',
        method: 'ARCHIVE',
        table: 'clients',
        id: clientRow.id,
      },
    ]

    for (const { label, ...operation } of malformedOperations) {
      const response = await batch(client, [operation])
      assert.equal(response.status(), 400, label)
      assert.deepEqual(await readStudioState(client), before)
    }
  })

  test('allows a full-row allocation metadata edit after a resource boundary creates a retained conflict', async ({
    client,
    assert,
  }) => {
    await resetSeed(client)
    const before = await readStudioState(client)
    const allocation = before.allocations.find((row) => row.id === 'a-tyler-1')!
    const resource = before.resources.find((row) => row.id === allocation.resourceId)!
    const laterBoundary = addDaysISO(allocation.endDate, 1)

    const boundary = await batch(client, [
      {
        method: 'PUT',
        table: 'resources',
        id: resource.id,
        row: { ...resource, firstAvailableDate: laterBoundary },
      },
    ])
    boundary.assertStatus(200)

    const retained = await readStudioState(client)
    const existing = retained.allocations.find((row) => row.id === allocation.id)!
    assert.isTrue(existing.endDate < laterBoundary)
    const edit = await batch(client, [
      {
        method: 'PUT',
        table: 'allocations',
        id: existing.id,
        row: { ...existing, note: 'Keep context' },
      },
    ])
    edit.assertStatus(200)

    const afterEdit = await readStudioState(client)
    const saved = afterEdit.allocations.find((row) => row.id === existing.id)!
    assert.equal(saved.note, 'Keep context')
    assert.equal(saved.startDate, existing.startDate)
    assert.equal(saved.endDate, existing.endDate)
  })

  test('applies the stored company calendar when validating availability through batch writes', async ({
    client,
    assert,
  }) => {
    await resetSeed(client)
    const { data } = studioSeed()
    const account = tableRow(data, 'accounts', 'a-studio')
    const person = {
      ...data.resources.find((row) => row.id === 'r-tyler')!,
      id: 'm2b-calendar-person',
    }
    const calendar = await batch(client, [
      {
        method: 'PUT',
        table: 'accounts',
        id: account.id,
        row: { ...account, workingDays: [1, 2, 3, 4] },
      },
      {
        method: 'PUT',
        table: 'resources',
        id: person.id,
        row: { ...person, lastAvailableDate: '2026-06-04' },
      },
    ])
    calendar.assertStatus(200)

    const allocation = data.allocations.find((row) => row.id === 'a-tyler-1')!
    const normal = await batch(client, [
      {
        method: 'PUT',
        table: 'allocations',
        id: 'm2b-calendar-normal',
        row: {
          ...allocation,
          id: 'm2b-calendar-normal',
          resourceId: person.id,
          startDate: '2026-06-04',
          endDate: '2026-06-05',
          ignoreWeekends: false,
        },
      },
    ])
    normal.assertStatus(200)

    const ignored = await batch(client, [
      {
        method: 'PUT',
        table: 'allocations',
        id: 'm2b-calendar-ignored',
        row: {
          ...allocation,
          id: 'm2b-calendar-ignored',
          resourceId: person.id,
          startDate: '2026-06-04',
          endDate: '2026-06-05',
          ignoreWeekends: true,
        },
      },
    ])
    ignored.assertStatus(400)
    assert.equal(responseCode(ignored), 'allocation_after_resource_availability')

    const after = await readStudioState(client)
    assert.isDefined(after.allocations.find((row) => row.id === 'm2b-calendar-normal'))
    assert.isUndefined(after.allocations.find((row) => row.id === 'm2b-calendar-ignored'))
  })

  test('rolls back a batch when an allocation exceeds its last-available boundary', async ({
    client,
    assert,
  }) => {
    await resetSeed(client)
    const { data } = studioSeed()
    const person = {
      ...data.resources.find((row) => row.id === 'r-tyler')!,
      id: 'm2b-after-boundary-person',
    }
    const bounded = await batch(client, [
      {
        method: 'PUT',
        table: 'resources',
        id: person.id,
        row: { ...person, lastAvailableDate: '2026-06-01' },
      },
    ])
    bounded.assertStatus(200)
    const before = await readStudioState(client)
    const allocation = data.allocations.find((row) => row.id === 'a-tyler-1')!
    const response = await batch(client, [
      {
        method: 'PUT',
        table: 'allocations',
        id: 'm2b-inside-boundary',
        row: {
          ...allocation,
          id: 'm2b-inside-boundary',
          resourceId: person.id,
          startDate: '2026-06-01',
          endDate: '2026-06-01',
        },
      },
      {
        method: 'PUT',
        table: 'allocations',
        id: 'm2b-after-boundary',
        row: {
          ...allocation,
          id: 'm2b-after-boundary',
          resourceId: person.id,
          startDate: '2026-06-08',
          endDate: '2026-06-08',
        },
      },
    ])

    response.assertStatus(400)
    assert.equal(responseCode(response), 'allocation_after_resource_availability')
    assert.deepEqual(await readStudioState(client), before)
  })
})
