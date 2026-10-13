import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import testUtils from '@adonisjs/core/services/test_utils'
import { seed } from '@capacitylens/shared/data/seed'
import type { AppData } from '@capacitylens/shared/types/entities'
import { invalidFieldCases } from './input_cases.js'

async function reset(client: ApiClient) {
  const response = await client.post('/api/test/reset').json({ seed: true }).send()
  response.assertStatus(200)
}

async function state(client: ApiClient) {
  const response = await client.get('/api/state?accountId=a-studio').send()
  response.assertStatus(200)
  return response.body() as AppData
}

async function putOps(client: ApiClient, ops: unknown[]) {
  return client
    .post('/api/batch')
    .json({ ops } as never)
    .send()
}

test.group('M2a batch input contract', (group) => {
  group.setup(() => testUtils.db().migrate())

  test('rejects malformed supplied entity fields and leaves the seeded account unchanged', async ({
    client,
    assert,
  }) => {
    await reset(client)
    const before = await state(client)
    const cases = invalidFieldCases(seed())

    for (const { table, row, field, invalid } of cases) {
      const candidate = { ...row, [field]: invalid }
      const response = await putOps(client, [
        { method: 'PUT', table, id: String(row.id), row: candidate },
      ])
      assert.equal(response.status(), 400, `${String(table)}.${field} must be rejected`)
      assert.deepEqual(
        await state(client),
        before,
        `${String(table)}.${field} must not change stored state`
      )
    }
  })

  test('rejects unknown fields, missing required fields, malformed operation roots and malformed nested rows', async ({
    client,
    assert,
  }) => {
    await reset(client)
    const before = await state(client)
    const person = seed().resources.find((row) => row.id === 'r-tyler')!
    const badRequests: unknown[] = [
      null,
      {},
      { ops: null },
      { ops: {} },
      { ops: [null] },
      { ops: [{ method: 'PATCH', table: 'clients', id: 'c-acme' }] },
      { ops: [{ method: 'PUT', table: 'clients', id: 'c-acme' }] },
      { ops: [{ method: 'PUT', table: 'clients', id: 'c-acme', row: null }] },
      { ops: [{ method: 'PUT', table: 'clients', id: 'c-acme', row: [] }] },
      {
        ops: [
          {
            method: 'PUT',
            table: 'clients',
            id: 'c-acme',
            row: { ...seed().clients[2], id: 'elsewhere' },
          },
        ],
      },
      {
        ops: [
          {
            method: 'PUT',
            table: 'clients',
            id: 'c-acme',
            row: { ...seed().clients[2], surprise: true },
          },
        ],
      },
      {
        ops: [
          {
            method: 'PUT',
            table: 'resources',
            id: person.id,
            row: { ...person, unexpected: 'value' },
          },
        ],
      },
      { ops: [{ method: 'PUT', table: 'resources', id: person.id, row: { ...person, name: 42 } }] },
      {
        ops: [
          {
            method: 'PUT',
            table: 'resources',
            id: person.id,
            row: { ...person, workingDays: 'weekdays' },
          },
        ],
      },
      {
        ops: [
          {
            method: 'PUT',
            table: 'resources',
            id: person.id,
            row: { ...person, workingDays: [1, 1] },
          },
        ],
      },
    ]

    for (const payload of badRequests) {
      const response = await client
        .post('/api/batch')
        .json(payload as never)
        .send()
      assert.equal(
        response.status(),
        400,
        `invalid request should be 400: ${JSON.stringify(payload)}`
      )
      assert.deepEqual(await state(client), before, 'invalid input must not change stored state')
    }
  })

  test('rejects ambiguous and malformed JSON before a batch write', async ({ client, assert }) => {
    await reset(client)
    const before = await state(client)
    const requests: Array<string | Buffer> = [
      '{"ops":[],"ops":[]}',
      `${'['.repeat(65)}0${']'.repeat(65)}`,
      '{"ops":[],"number":9007199254740992}',
      Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]),
    ]

    for (const payload of requests) {
      const request = client.post('/api/batch').header('content-type', 'application/json')
      request.request.send(payload)
      const response = await request.send()
      assert.equal(response.status(), 400)
      assert.deepEqual(await state(client), before)
    }
  })

  test('accepts a valid full-row fixture for every entity with a real calendar date', async ({
    client,
    assert,
  }) => {
    await reset(client)
    const rows = invalidFieldCases(seed())
    const tables = [...new Set(rows.map(({ table }) => table))]

    for (const table of tables) {
      const original = rows.find((item) => item.table === table)!.row
      const candidate = { ...original }
      if (table === 'resources') candidate.firstAvailableDate = '2026-02-01'
      if (table === 'allocations' || table === 'timeOff' || table === 'closures') {
        candidate.startDate = '2026-02-01'
        candidate.endDate = '2026-02-28'
      }
      const response = await putOps(client, [
        { method: 'PUT', table, id: String(candidate.id), row: candidate },
      ])
      assert.equal(response.status(), 200, `${String(table)} accepts its valid fixture`)
    }
  })

  test('requires named person and external resources and accepts a valid external company name', async ({
    client,
    assert,
  }) => {
    await reset(client)
    const before = await state(client)
    const person = seed().resources.find((row) => row.id === 'r-tyler')!
    const unnamedPerson = { ...person, id: 'contract-unnamed-person' }
    delete (unnamedPerson as Partial<typeof unnamedPerson>).name
    const rejectedPerson = await putOps(client, [
      { method: 'PUT', table: 'resources', id: unnamedPerson.id, row: unnamedPerson },
    ])
    assert.equal(rejectedPerson.status(), 400)
    assert.deepEqual(await state(client), before)

    const base = seed().resources.find((row) => row.id === 'r-ext-northstar')!
    const unnamed = { ...base, id: 'contract-unnamed-external' }
    delete (unnamed as Partial<typeof unnamed>).name
    const rejected = await putOps(client, [
      { method: 'PUT', table: 'resources', id: unnamed.id, row: unnamed },
    ])
    assert.equal(rejected.status(), 400)
    assert.deepEqual(await state(client), before)

    const named = { ...unnamed, name: 'Queen Consolidated' }
    const accepted = await putOps(client, [
      { method: 'PUT', table: 'resources', id: named.id, row: named },
    ])
    assert.equal(accepted.status(), 200)
    const saved = await state(client)
    assert.equal(saved.resources.find((row) => row.id === named.id)?.name, 'Queen Consolidated')
  })

  test('preserves opaque allocation identifiers beyond the text-name limit', async ({
    client,
    assert,
  }) => {
    await reset(client)
    const data = seed()
    const projectId = 'p'.repeat(101)
    const activityId = 'repeatable-opaque'
    const seriesId = 's'.repeat(256)
    const project = { ...data.projects[0]!, id: projectId }
    const activity = {
      ...data.activities.find((row) => row.id === 't-design')!,
      id: activityId,
      name: 'Opaque allocation activity',
      kind: 'repeatable',
      projectId: undefined,
      phaseId: undefined,
    }
    const allocation = {
      ...data.allocations[0]!,
      id: 'allocation-opaque-ids',
      activityId,
      projectId,
      seriesId,
      startDate: '2026-06-15',
      endDate: '2026-06-15',
      hoursPerDay: 4,
    }
    const accepted = await putOps(client, [
      { method: 'PUT', table: 'projects', id: projectId, row: project },
      { method: 'PUT', table: 'activities', id: activityId, row: activity },
      { method: 'PUT', table: 'allocations', id: allocation.id, row: allocation },
    ])
    assert.equal(accepted.status(), 200)
    const acceptedState = await state(client)
    const saved = acceptedState.allocations.find((row) => row.id === allocation.id)
    assert.deepEqual(
      { projectId: saved?.projectId, seriesId: saved?.seriesId },
      { projectId, seriesId }
    )

    const tooLong = { ...allocation, id: 'allocation-long-series', seriesId: 's'.repeat(257) }
    const rejected = await putOps(client, [
      { method: 'PUT', table: 'allocations', id: tooLong.id, row: tooLong },
    ])
    assert.equal(rejected.status(), 400)
    const rejectedState = await state(client)
    assert.isUndefined(rejectedState.allocations.find((row) => row.id === tooLong.id))
  })

  test('normalizes accepted composed text while preserving punctuation', async ({
    client,
    assert,
  }) => {
    await reset(client)
    const clientRow = { ...seed().clients.find((row) => row.id === 'c-acme')! }
    const acceptedName = `  ${'e\u0301'.repeat(60)}   O'Brien  `
    const response = await putOps(client, [
      {
        method: 'PUT',
        table: 'clients',
        id: clientRow.id,
        row: { ...clientRow, name: acceptedName },
      },
    ])
    assert.equal(response.status(), 200)
    const current = await state(client)
    assert.equal(
      current.clients.find((row) => row.id === clientRow.id)?.name,
      `${'é'.repeat(60)} O'Brien`
    )
  })
})
