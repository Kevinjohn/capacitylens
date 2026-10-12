import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
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

function isFullProductTableSelect(sql: string) {
  const normalized = sql.toLowerCase().replaceAll('`', '').replace(/\s+/g, ' ')
  return (
    PRODUCT_TABLES.some(
      (table) => normalized.startsWith(`select `) && normalized.includes(` from ${table}`)
    ) && !normalized.includes(' where ')
  )
}

test.group('M2a scoped batch projections', (group) => {
  group.setup(() => testUtils.db().migrate())

  test('performs no full product-table SELECT for empty or single-company batches', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
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

  test('writes only the targeted lifecycle row and leaves tenant siblings untouched', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    const project = seed().projects.find((row) => row.id === 'p-acme')!
    const sibling = seed().projects.find(
      (row) => row.accountId === project.accountId && row.id !== project.id
    )
    const queries: string[] = []
    const knex = db.connection().getReadClient()
    const record = (query: { sql?: unknown }) => {
      if (typeof query.sql === 'string') queries.push(query.sql)
    }
    knex.on('query', record)
    try {
      const response = await trusted(client.post(`/api/projects/${project.id}/archive`))
        .json({ accountId: project.accountId })
        .send()
      response.assertStatus(200)
    } finally {
      knex.off('query', record)
    }

    const productUpdates = queries.filter((sql) => {
      const normalized = sql.toLowerCase().replaceAll('`', '').trim()
      return PRODUCT_TABLES.some((table) => normalized.startsWith(`update ${table} `))
    })
    assert.lengthOf(productUpdates, 1)
    assert.match(productUpdates[0]!, /^update `?projects`? /i)
    if (sibling) {
      const storedSibling = await db.from('projects').where('id', sibling.id).first()
      assert.isNull(storedSibling.archived_at)
    }
  })
})
