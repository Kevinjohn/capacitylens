import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import {
  authenticatedDataClient,
  resetAuthenticatedData,
} from '../../helpers/authenticated_data_fixture.js'
import { freshDatabase } from '../../helpers/fresh_database.js'
import { seed } from '@capacitylens/shared/data/seed'
import db from '@adonisjs/lucid/services/db'
import { buildInternalClient } from '@capacitylens/shared/data/internalClient'

const trusted = <T extends { header(name: string, value: string): T }>(request: T) =>
  request.header('sec-fetch-site', 'same-origin')

async function reset(client: ApiClient, seeded = true) {
  const session = await resetAuthenticatedData(client, seeded)
  return authenticatedDataClient(client, session.cookie)
}

test.group('M2a company batches', (group) => {
  group.setup(() => freshDatabase())

  test('creates one canonical Internal client beside a new company', async ({ client, assert }) => {
    client = await reset(client, false)
    const response = await trusted(client.post('/api/orgs'))
      .json({ id: 'a-new', name: 'Wayne Aerospace' })
      .send()
    response.assertStatus(201)

    const stored = await client.get('/api/state?accountId=a-new').send()
    stored.assertStatus(200)
    const body = stored.body() as unknown as {
      clients: Array<Record<string, unknown>>
    }
    assert.deepInclude(body.clients[0], {
      id: 'internal:a-new',
      accountId: 'a-new',
      name: 'Internal',
      builtin: true,
    })
  })

  test('serializes concurrent first-company setup and creates one Internal client', async ({
    client,
    assert,
  }) => {
    client = await reset(client, false)
    const attempts = [
      { id: 'a-concurrent-one', name: 'Wayne Aerospace' },
      { id: 'a-concurrent-two', name: 'Queen Consolidated' },
    ]
    const responses = await Promise.all(
      attempts.map(({ id, name }) => trusted(client.post('/api/orgs')).json({ id, name }).send())
    )

    assert.deepEqual(responses.map((response) => response.status()).sort(), [201, 403])
    const accounts = await db.from('accounts').select('id')
    assert.lengthOf(accounts, 1)
    const clients = await db.from('clients').select('id', 'account_id', 'name', 'builtin')
    assert.deepEqual(clients, [
      {
        id: `internal:${accounts[0]!.id}`,
        account_id: accounts[0]!.id,
        name: 'Internal',
        builtin: 'true',
      },
    ])
  })

  test('atomically adopts a legacy Internal id without losing its projects', async ({
    client,
    assert,
  }) => {
    client = await reset(client, false)
    const accountResponse = await trusted(client.post('/api/orgs'))
      .json({ id: 'a-adopt', name: 'Wayne Aerospace' })
      .send()
    accountResponse.assertStatus(201)
    const stateResponse = await client.get('/api/state?accountId=a-adopt').send()
    const account = stateResponse.body() as unknown as {
      accounts: Array<Record<string, unknown>>
    }
    const createdAccount = account.accounts[0]!
    const project = {
      ...seed().projects[0],
      id: 'p-adopt',
      accountId: 'a-adopt',
      clientId: 'internal:a-adopt',
    }
    const setup = await trusted(client.post('/api/batch'))
      .json({
        ops: [{ method: 'PUT', table: 'projects', id: project.id, row: project }],
      })
      .send()
    setup.assertStatus(200)
    const generatedId = 'internal:a-adopt'
    const replacement = buildInternalClient(
      'a-adopt',
      String(createdAccount.createdAt),
      'legacy-internal'
    )
    const failed = await trusted(client.post('/api/batch'))
      .json({
        ops: [
          { method: 'PUT', table: 'clients', id: replacement.id, row: { ...replacement } },
          {
            method: 'PUT',
            table: 'disciplines',
            id: 'wrong-id',
            row: { ...seed().disciplines[0], id: 'different-id', accountId: 'a-adopt' },
          },
        ],
      })
      .send()
    failed.assertStatus(400)
    assert.exists(await db.from('clients').where('id', generatedId).first())
    assert.isNull(await db.from('clients').where('id', replacement.id).first())
    const rolledBackProject = await db.from('projects').where('id', project.id).first()
    assert.equal(rolledBackProject.client_id, generatedId)

    const adopted = await trusted(client.post('/api/batch'))
      .json({
        ops: [{ method: 'PUT', table: 'clients', id: replacement.id, row: { ...replacement } }],
      })
      .send()
    adopted.assertStatus(200)
    assert.isNull(await db.from('clients').where('id', generatedId).first())
    assert.exists(await db.from('clients').where('id', replacement.id).first())
    const reparented = await db.from('projects').where('id', project.id).first()
    assert.equal(reparented.client_id, replacement.id)
    assert.isAbove(Date.parse(reparented.updated_at), Date.parse(rolledBackProject.updated_at))
  })

  test('rejects a batch that attempts to create multiple companies', async ({ client, assert }) => {
    client = await reset(client, false)
    const source = seed().accounts[0]
    const first = await trusted(client.post('/api/orgs'))
      .json({ id: 'a-first', name: 'Wayne Enterprises' })
      .send()
    first.assertStatus(201)
    const response = await trusted(client.post('/api/batch'))
      .json({
        ops: [
          { method: 'PUT', table: 'accounts', id: 'a-second', row: { ...source, id: 'a-second' } },
        ],
      })
      .send()
    response.assertStatus(403)

    const accounts = await client.get('/api/accounts').send()
    accounts.assertStatus(200)
    assert.deepEqual(
      (accounts.body() as unknown as Array<{ id: string }>).map((account) => account.id),
      ['a-first']
    )
  })

  test('rejects company replacement through a generic batch in either operation order', async ({
    client,
    assert,
  }) => {
    const source = seed().accounts[0]!
    const original = { ...source, id: 'a-original', name: 'Wayne Enterprises' }
    const replacement = { ...source, id: 'a-replacement', name: 'Wayne Aerospace' }
    const removeOriginal = { method: 'DELETE', table: 'accounts', id: original.id } as const
    const createReplacement = {
      method: 'PUT',
      table: 'accounts',
      id: replacement.id,
      row: replacement,
    } as const

    for (const ops of [
      [removeOriginal, createReplacement],
      [createReplacement, removeOriginal],
    ]) {
      client = await reset(client, false)
      const setup = await trusted(client.post('/api/orgs'))
        .json({ id: original.id, name: original.name })
        .send()
      setup.assertStatus(201)

      const response = await trusted(client.post('/api/batch')).json({ ops }).send()
      response.assertStatus(400)

      const accounts = await client.get('/api/accounts').send()
      accounts.assertStatus(200)
      assert.deepEqual(
        (accounts.body() as unknown as Array<{ id: string }>).map((account) => account.id),
        [original.id]
      )
    }
  })

  test('does not expose company creation through the generic batch route', async ({
    client,
    assert,
  }) => {
    const source = seed().accounts[0]!
    client = await reset(client, false)
    const response = await trusted(client.post('/api/batch'))
      .json({
        ops: [
          { method: 'PUT', table: 'accounts', id: 'a-batch', row: { ...source, id: 'a-batch' } },
        ],
      })
      .send()
    response.assertStatus(403)
    assert.deepEqual(response.body(), {
      error: 'Company creation is only available through company setup.',
    })
    assert.isNull(await db.from('accounts').where('id', 'a-batch').first())
  })
})
