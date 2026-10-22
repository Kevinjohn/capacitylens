import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import {
  authenticatedDataClient,
  resetAuthenticatedData,
} from '../../helpers/authenticated_data_fixture.js'
import { freshDatabase } from '../../helpers/fresh_database.js'
import db from '@adonisjs/lucid/services/db'
import { seed } from '@capacitylens/shared/data/seed'

const PRODUCT_TABLES = [
  'accounts',
  'clients',
  'disciplines',
  'projects',
  'phases',
  'resources',
  'activities',
  'allocations',
  'time_off',
  'closures',
] as const

const trusted = <T extends { header(name: string, value: string): T }>(request: T) =>
  request.header('sec-fetch-site', 'same-origin')

async function reset(client: ApiClient, seeded = true) {
  const session = await resetAuthenticatedData(client, seeded)
  return authenticatedDataClient(client, session.cookie)
}

function isFullProductTableSelect(sql: string) {
  const normalized = sql.toLowerCase().replaceAll('`', '').replace(/\s+/g, ' ')
  return (
    PRODUCT_TABLES.some(
      (table) => normalized.startsWith(`select `) && normalized.includes(` from ${table}`)
    ) && !normalized.includes(' where ')
  )
}

test.group('M2a scoped batch projections', (group) => {
  group.setup(() => freshDatabase())

  test('performs no full product-table SELECT for empty or single-company batches', async ({
    client,
    assert,
  }) => {
    client = await reset(client, true)
    const queries: string[] = []
    const knex = db.connection().getReadClient()
    const record = (query: { sql?: unknown }) => {
      if (typeof query.sql === 'string') queries.push(query.sql)
    }
    knex.on('query', record)
    try {
      const empty = await trusted(client.post('/api/batch')).json({ ops: [] }).send()
      empty.assertStatus(200)
      assert.lengthOf(queries.filter(isFullProductTableSelect), 0)

      queries.length = 0
      const current = seed().clients.find((row) => row.id === 'c-acme')!
      const scoped = await trusted(client.post('/api/batch'))
        .json({
          ops: [
            {
              method: 'PUT',
              table: 'clients',
              id: current.id,
              row: { ...current, name: 'Scoped query guard' },
            },
          ],
        })
        .send()
      scoped.assertStatus(200)
      assert.lengthOf(queries.filter(isFullProductTableSelect), 0)
      assert.isTrue(
        queries.some((sql) => sql.toLowerCase().includes(' from `clients` where `account_id`'))
      )
    } finally {
      knex.off('query', record)
    }
  })
})
