import { test } from '@japa/runner'
import { freshDatabase } from '../../helpers/fresh_database.js'
import { replaceWithSeed } from '#services/state_repository'
import db from '@adonisjs/lucid/services/db'
import { seed } from '@capacitylens/shared/data/seed'
import env from '#start/env'

const securityHeaders = [
  'content-security-policy',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
  'referrer-policy',
  'x-content-type-options',
  'x-frame-options',
]

test.group('M1 HTTP contract', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(() => replaceWithSeed())

  test('validates state queries and scopes the account read', async ({ client, assert }) => {
    const empty = await client.get('/api/state?accountId=')
    assert.equal(empty.status(), 400)
    assert.deepEqual(empty.body(), { error: 'accountId must be a non-empty string.' })
    const repeated = await client.get('/api/state?accountId=a-studio&accountId=a-loft')
    assert.equal(repeated.status(), 400)
    const whitespace = await client.get('/api/state?accountId=%20%20')
    assert.equal(whitespace.status(), 400)
    assert.deepEqual(whitespace.body(), { error: 'accountId must be a non-empty string.' })
    const invalidInactive = await client.get('/api/state?accountId=a-studio&includeInactive=true')
    assert.equal(invalidInactive.status(), 400)
    assert.deepEqual(invalidInactive.body(), {
      error: 'includeInactive must be the literal value 1 when present.',
    })
    const scoped = await client.get('/api/state?accountId=a-studio')
    assert.equal(scoped.status(), 200)
    assert.deepEqual(
      scoped.body().accounts.map(({ id }: { id: string }) => id),
      ['a-studio']
    )
    for (const key of [
      'clients',
      'disciplines',
      'projects',
      'phases',
      'resources',
      'activities',
      'allocations',
      'timeOff',
      'closures',
    ])
      assert.isTrue(
        scoped
          .body()
          [key].every(({ accountId }: { accountId: string }) => accountId === 'a-studio'),
        key
      )
  })

  test('reset without seed wipes and seed true restores data', async ({ client, assert }) => {
    const wiped = await client.post('/api/test/reset').json({})
    assert.equal(wiped.status(), 200)
    const emptyMeta = await client.get('/api/meta')
    assert.deepEqual(emptyMeta.body(), { hasData: false })
    const restored = await client.post('/api/test/reset').json({ seed: true })
    assert.equal(restored.status(), 200)
    const seededMeta = await client.get('/api/meta')
    assert.deepEqual(seededMeta.body(), { hasData: true })
  })

  test('reset returns the retained refusal when disabled', async ({ client, assert }) => {
    const enabled = env.get('CAPACITYLENS_ALLOW_RESET')
    env.set('CAPACITYLENS_ALLOW_RESET', false)
    try {
      const response = await client.post('/api/test/reset').json({ seed: true })
      assert.equal(response.status(), 403)
      assert.deepEqual(response.body(), { error: 'Reset is disabled.' })
    } finally {
      env.set('CAPACITYLENS_ALLOW_RESET', enabled)
    }
  })

  test('sets security headers on successful and early error responses', async ({
    client,
    assert,
  }) => {
    for (const response of [
      await client.get('/api/health'),
      await client
        .post('/api/test/reset')
        .header('content-type', 'application/json')
        .setup((request) => {
          request.request.send('{')
        }),
    ]) {
      for (const header of securityHeaders) assert.isString(response.header(header), header)
      assert.equal(response.header('cache-control'), 'no-store')
      assert.equal(response.header('pragma'), 'no-cache')
      assert.equal(response.header('x-content-type-options'), 'nosniff')
      assert.equal(response.header('x-frame-options'), 'DENY')
    }
  })

  test('reflects only allowed credentialed CORS origins and gates unsafe cross-site writes', async ({
    client,
    assert,
  }) => {
    const allowed = 'http://localhost:5173'
    const accepted = await client.get('/api/health').header('origin', allowed)
    assert.equal(accepted.header('access-control-allow-origin'), allowed)
    assert.equal(accepted.header('access-control-allow-credentials'), 'true')

    const disallowed = await client.get('/api/health').header('origin', 'https://attacker.example')
    assert.isUndefined(disallowed.header('access-control-allow-origin'))
    assert.equal(disallowed.status(), 200)

    const preflight = await client
      .options('/api/test/reset')
      .header('origin', allowed)
      .header('access-control-request-method', 'POST')
      .header('access-control-request-headers', 'content-type')
    assert.equal(preflight.status(), 204)
    assert.equal(preflight.header('access-control-allow-origin'), allowed)

    const discipline = seed().disciplines[0]!
    const allowedWrite = await client
      .post('/api/batch')
      .header('origin', allowed)
      .header('sec-fetch-site', 'cross-site')
      .json({
        ops: [
          {
            method: 'PUT',
            table: 'disciplines',
            id: discipline.id,
            row: { ...discipline } as Record<string, unknown>,
          },
        ],
      })
    assert.equal(allowedWrite.status(), 200)

    const disallowedWrite = await client
      .post('/api/test/reset')
      .header('origin', 'https://attacker.example')
      .json({ seed: true })
    assert.equal(disallowedWrite.status(), 403)
    assert.deepEqual(disallowedWrite.body(), { error: 'Cross-site request rejected.' })
    assert.equal(disallowedWrite.header('x-content-type-options'), 'nosniff')
    assert.equal(disallowedWrite.header('x-frame-options'), 'DENY')

    const originlessCrossSite = await client
      .post('/api/test/reset')
      .header('sec-fetch-site', 'cross-site')
      .json({ seed: true })
    assert.equal(originlessCrossSite.status(), 403)

    const nonBrowser = await client.post('/api/test/reset').json({ seed: true })
    assert.equal(nonBrowser.status(), 200)

    const tlsTerminatedSameHost = await client
      .post('/api/test/reset')
      .header('host', 'capacity.example.com')
      .header('origin', 'https://capacity.example.com')
      .json({ seed: true })
    assert.equal(tlsTerminatedSameHost.status(), 200)

    const tlsTerminatedOtherHost = await client
      .post('/api/test/reset')
      .header('host', 'capacity.example.com')
      .header('origin', 'https://other.example.com')
      .json({ seed: true })
    assert.equal(tlsTerminatedOtherHost.status(), 403)
  })

  test('diagnostics preserves the unavailable database projection', async ({ client, assert }) => {
    await db.rawQuery('DROP INDEX closures_account_id_index')
    try {
      const response = await client.get('/api/diagnostics')
      assert.equal(response.status(), 503)
      assert.deepEqual(response.body(), {
        server: {
          connectivity: 'ok',
          database: { status: 'unavailable', schemaVersion: null },
          persistence: 'unknown',
          backup: { status: 'unavailable', lastSuccessAt: null },
        },
      })
    } finally {
      await db.rawQuery('CREATE INDEX closures_account_id_index ON closures (account_id)')
    }
  })
})
