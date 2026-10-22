import { test } from '@japa/runner'
import {
  authenticatedDataClient,
  resetAuthenticatedData,
} from '../../helpers/authenticated_data_fixture.js'
import type { ApiClient } from '@japa/api-client'
import { freshDatabase } from '../../helpers/fresh_database.js'
import { seed } from '@capacitylens/shared/data/seed'
import type { AppData, AppDataKey } from '@capacitylens/shared/types/entities'

async function reset(client: ApiClient, seeded = true) {
  const session = await resetAuthenticatedData(client, seeded)
  return authenticatedDataClient(client, session.cookie)
}

async function state(client: ApiClient, accountId = 'a-studio') {
  const response = await client.get(`/api/state?accountId=${accountId}`).send()
  response.assertStatus(200)
  return response.body() as AppData
}

async function put(client: ApiClient, table: AppDataKey, row: Record<string, unknown>) {
  return client
    .post('/api/batch')
    .json({ ops: [{ method: 'PUT', table, id: String(row.id), row }] })
    .send()
}

const trusted = <T extends { header(name: string, value: string): T }>(request: T) =>
  request.header('sec-fetch-site', 'same-origin')

test.group('M2a ordinary-write normalization', (group) => {
  group.setup(() => freshDatabase())

  test('public clients and projects store privacy as absence after a full-row update', async ({
    client,
    assert,
  }) => {
    client = await reset(client)
    for (const [table, id] of [
      ['clients', 'c-acme'],
      ['projects', 'p-acme'],
    ] as const) {
      const before = await state(client)
      const current = before[table].find((row) => row.id === id)!
      const response = await put(client, table, {
        ...current,
        isPrivate: false,
        codeName: 'Public Echo',
      })
      response.assertStatus(200)
      const after = await state(client)
      const stored = after[table].find((row) => row.id === id)!
      assert.isNull(stored.isPrivate)
      assert.isNull(stored.codeName)
    }
  })

  test('private client and project code names lose only surrounding quotation marks', async ({
    client,
    assert,
  }) => {
    client = await reset(client)
    for (const [table, id] of [
      ['clients', 'c-acme'],
      ['projects', 'p-acme'],
    ] as const) {
      const before = await state(client)
      const current = before[table].find((row) => row.id === id)!
      const response = await put(client, table, {
        ...current,
        isPrivate: true,
        codeName: '  “Watchtower”  ',
      })
      response.assertStatus(200)
      const after = await state(client)
      const stored = after[table].find((row) => row.id === id)!
      assert.equal(stored.isPrivate, true)
      assert.equal(stored.codeName, 'Watchtower')
    }
  })

  test('a normal client omits false builtin and a person stores canonical weekday sets', async ({
    client,
    assert,
  }) => {
    client = await reset(client)
    const before = await state(client)
    const clientRow = before.clients.find((row) => row.id === 'c-acme')!
    const clientWrite = await put(client, 'clients', { ...clientRow, builtin: false })
    clientWrite.assertStatus(200)
    const afterClient = await state(client)
    const storedClient = afterClient.clients.find((row) => row.id === clientRow.id)!
    assert.isNull(storedClient.builtin)

    const person = before.resources.find((row) => row.id === 'r-tyler')!
    const resourceWrite = await put(client, 'resources', {
      ...person,
      workingDays: [5, 3, 1, 4, 2],
      halfDays: [5, 1],
    })
    resourceWrite.assertStatus(200)
    const afterResource = await state(client)
    const storedPerson = afterResource.resources.find((row) => row.id === person.id)!
    assert.deepEqual(storedPerson.workingDays, [1, 2, 3, 4, 5])
    assert.deepEqual(storedPerson.halfDays, [1, 5])
  })

  test('a new Sunday-start account defaults omitted working days and keeps them on omission', async ({
    client,
    assert,
  }) => {
    client = await reset(client, false)
    const source = seed().accounts.find((row) => row.id === 'a-studio')!
    const account = { ...source, id: 'a-sunday', weekStartsOn: 0 } as Record<string, unknown>
    delete account.workingDays
    const created = await trusted(client.post('/api/orgs'))
      .json({ id: account.id, name: account.name, weekStartsOn: account.weekStartsOn })
      .send()
    created.assertStatus(201)
    const afterCreate = await state(client, 'a-sunday')
    const stored = afterCreate.accounts.find((row) => row.id === account.id)!
    assert.deepEqual(stored.workingDays, [0, 1, 2, 3, 4])

    const update = { ...stored, name: 'Wayne Sunday Studio' } as Record<string, unknown>
    delete update.workingDays
    const updated = await put(client, 'accounts', update)
    updated.assertStatus(200)
    const afterUpdate = await state(client, 'a-sunday')
    const retained = afterUpdate.accounts.find((row) => row.id === account.id)!
    assert.deepEqual(retained.workingDays, [0, 1, 2, 3, 4])
  })
})
