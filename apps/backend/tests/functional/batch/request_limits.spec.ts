import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import server from '@adonisjs/core/services/server'
import { seed } from '@capacitylens/shared/data/seed'
import { encodeRow } from '#services/state_repository'
import { MAX_SERVER_CONNECTIONS } from '#start/resource_limits'

const MAX_BATCH_HANDLER_BUDGET_MS = 4000

const trusted = <T extends { header(name: string, value: string): T }>(request: T) =>
  request.header('sec-fetch-site', 'same-origin')

async function reset(client: ApiClient, seeded = true) {
  const response = await client.post('/api/test/reset').json({ seed: seeded }).send()
  response.assertStatus(200)
}

function putBatch(client: ApiClient, ops: unknown[]) {
  return trusted(client.post('/api/batch'))
    .json({ ops } as never)
    .send()
}

test.group('M2a request limits', (group) => {
  group.setup(() => testUtils.db().migrate())

  test('rejects 5001 operations before changing storage', async ({ client, assert }) => {
    await reset(client, false)
    const source = seed().accounts[0]!
    const ops = Array.from({ length: 5001 }, (_, index) => {
      const id = `a-limit-${index}`
      return { method: 'PUT', table: 'accounts', id, row: { ...source, id } }
    })

    const response = await putBatch(client, ops)
    response.assertStatus(400)
    const errorBody = response.body() as unknown as { error?: string }
    assert.include(String(errorBody.error), '5000')
    assert.lengthOf(await db.from('accounts'), 0)
    assert.lengthOf(await db.from('clients'), 0)
  })

  test('accepts exactly 5000 valid operations against existing scoped rows', async ({
    client,
    assert,
  }) => {
    await reset(client, true)
    const source = seed().clients.find((row) => row.id === 'c-acme')!
    const rows = Array.from({ length: 5000 }, (_, index) => ({
      ...source,
      id: `c-limit-${index}`,
      name: `Capacity limit ${index}`,
    }))
    for (let offset = 0; offset < rows.length; offset += 100) {
      await db
        .table('clients')
        .insert(rows.slice(offset, offset + 100).map((row) => encodeRow('clients', row)))
    }
    const ops = rows.map((row) => ({
      method: 'PUT',
      table: 'clients',
      id: row.id,
      row: { ...row, name: `Updated ${row.id}` },
    }))

    const startedAt = performance.now()
    const response = await putBatch(client, ops)
    const elapsedMs = performance.now() - startedAt
    response.assertStatus(200)
    response.assertBodyContains({ applied: 5000, changed: 5000 })
    assert.isBelow(elapsedMs, MAX_BATCH_HANDLER_BUDGET_MS)
    assert.lengthOf(await db.from('clients').whereLike('name', 'Updated c-limit-%'), 5000)
  })

  test('applies the configured Node connection and request timeouts and rate-limits drop logs', async ({
    assert,
  }) => {
    const nodeServer = server.getNodeServer()
    assert.exists(nodeServer)
    assert.equal(nodeServer!.maxConnections, MAX_SERVER_CONNECTIONS)
    assert.equal(nodeServer!.requestTimeout, 30_000)
    assert.equal(nodeServer!.timeout, 30_000)

    const originalWarn = logger.warn
    const warnings: unknown[][] = []
    logger.warn = ((...args: unknown[]) => {
      warnings.push(args)
    }) as typeof logger.warn
    try {
      nodeServer!.emit('drop')
      nodeServer!.emit('drop')
      assert.lengthOf(warnings, 1)
      assert.deepEqual(warnings[0]?.[0], {
        event: 'connection_limit',
        outcome: 'blocked',
        limit: MAX_SERVER_CONNECTIONS,
      })
    } finally {
      logger.warn = originalWarn
    }
  })
})
