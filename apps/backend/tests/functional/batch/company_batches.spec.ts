import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { seed } from '@capacitylens/shared/data/seed'
import db from '@adonisjs/lucid/services/db'
import { withTransaction } from '#services/with_transaction'
import { applyBatch } from '#services/batch/service'
import { trustedLocalDataContext } from '#services/batch/data_policy'
import { buildInternalClient } from '@capacitylens/shared/data/internalClient'

const trusted = <T extends { header(name: string, value: string): T }>(request: T) =>
  request.header('sec-fetch-site', 'same-origin')

test.group('M2a company batches', (group) => {
  group.setup(() => testUtils.db().migrate())

  test('creates one canonical Internal client beside a new company', async ({ client, assert }) => {
    await client.post('/api/test/reset').json({ seed: false }).send()
    const source = seed().accounts[0]
    const account = { ...source, id: 'a-new', name: 'Wayne Aerospace' }
    const response = await trusted(client.post('/api/batch'))
      .json({ ops: [{ method: 'PUT', table: 'accounts', id: account.id, row: account }] })
      .send()
    response.assertStatus(200)

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

  test('atomically adopts a legacy Internal id without losing its projects', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: false }).send()
    const account = { ...seed().accounts[0], id: 'a-adopt', name: 'Wayne Aerospace' }
    const project = {
      ...seed().projects[0],
      id: 'p-adopt',
      accountId: account.id,
      clientId: `internal:${account.id}`,
    }
    const setup = await trusted(client.post('/api/batch'))
      .json({
        ops: [
          { method: 'PUT', table: 'accounts', id: account.id, row: account },
          { method: 'PUT', table: 'projects', id: project.id, row: project },
        ],
      })
      .send()
    setup.assertStatus(200)
    const generatedId = `internal:${account.id}`
    const replacement = buildInternalClient(account.id, account.createdAt, 'legacy-internal')
    const failed = await trusted(client.post('/api/batch'))
      .json({
        ops: [
          { method: 'PUT', table: 'clients', id: replacement.id, row: { ...replacement } },
          {
            method: 'PUT',
            table: 'disciplines',
            id: 'wrong-id',
            row: { ...seed().disciplines[0], id: 'different-id', accountId: account.id },
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

  test('rolls back a batch that would exceed the single-company cap', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: false }).send()
    const source = seed().accounts[0]
    const response = await trusted(client.post('/api/batch'))
      .json({
        ops: [
          { method: 'PUT', table: 'accounts', id: 'a-first', row: { ...source, id: 'a-first' } },
          { method: 'PUT', table: 'accounts', id: 'a-second', row: { ...source, id: 'a-second' } },
        ],
      })
      .send()
    response.assertStatus(403)

    const accounts = await client.get('/api/accounts').send()
    accounts.assertStatus(200)
    assert.deepEqual(accounts.body(), [])
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
      await client.post('/api/test/reset').json({ seed: false }).send()
      const setup = await trusted(client.post('/api/batch'))
        .json({ ops: [{ method: 'PUT', table: 'accounts', id: original.id, row: original }] })
        .send()
      setup.assertStatus(200)

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

  test('enforces first, concurrent, mixed, and multi-company creation policy atomically', async ({
    client,
    assert,
  }) => {
    const source = seed().accounts[0]!
    await client.post('/api/test/reset').json({ seed: false }).send()
    const create = (id: string, name = id) => ({ ...source, id, name })
    const first = await trusted(client.post('/api/batch'))
      .json({ ops: [{ method: 'PUT', table: 'accounts', id: 'a-first', row: create('a-first') }] })
      .send()
    first.assertStatus(200)

    const mixed = await trusted(client.post('/api/batch'))
      .json({
        ops: [
          {
            method: 'PUT',
            table: 'accounts',
            id: 'a-first',
            row: create('a-first', 'Must roll back'),
          },
          { method: 'PUT', table: 'accounts', id: 'a-capped', row: create('a-capped') },
        ],
      })
      .send()
    mixed.assertStatus(403)
    const retainedFirst = await db.from('accounts').where('id', 'a-first').first()
    assert.equal(retainedFirst.name, 'a-first')
    assert.isNull(await db.from('accounts').where('id', 'a-capped').first())

    await client.post('/api/test/reset').json({ seed: false }).send()
    const concurrent = await Promise.all(
      ['a-concurrent-one', 'a-concurrent-two'].map((id) =>
        trusted(client.post('/api/batch'))
          .json({ ops: [{ method: 'PUT', table: 'accounts', id, row: create(id) }] })
          .send()
      )
    )
    assert.deepEqual(concurrent.map((response) => response.status()).sort(), [200, 403])
    assert.lengthOf(await db.from('accounts'), 1)

    await client.post('/api/test/reset').json({ seed: false }).send()
    const multiContext = trustedLocalDataContext('multi-owner', true)
    await withTransaction((trx) =>
      applyBatch(
        trx,
        [
          { method: 'PUT', table: 'accounts', id: 'a-multi-one', row: create('a-multi-one') },
          { method: 'PUT', table: 'accounts', id: 'a-multi-two', row: create('a-multi-two') },
        ],
        null,
        multiContext
      )
    )
    assert.lengthOf(await db.from('accounts'), 2)
  })
})
