import { test } from '@japa/runner'
import { readFile } from 'node:fs/promises'
import { freshDatabase } from '../../helpers/fresh_database.js'
import { replaceWithSeed } from '#services/state_repository'
import { APP_DATA_KEYS, type AppData } from '@capacitylens/shared/types/entities'
import { fillNullableFields } from '@capacitylens/shared/types/nullableFields'
import { resetAuthenticatedClient } from '../../helpers/authenticated_data_fixture.js'

const fixture = JSON.parse(
  await readFile(new URL('../../fixtures-main-responses.json', import.meta.url), 'utf8')
) as {
  responses: Array<{
    method: 'GET' | 'POST'
    path: string
    status: number
    body: unknown
    headers: Record<string, string>
  }>
}

test.group('M1 read path', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(() => replaceWithSeed())
  for (const expected of fixture.responses.filter(
    (entry) => !['/api/test/reset', '/api/state', '/api/auth/me'].includes(entry.path)
  )) {
    test(`${expected.method} ${expected.path} matches the main response`, async ({
      client,
      assert,
    }) => {
      if (expected.path.startsWith('/api/state?') || expected.path === '/api/accounts')
        client = await resetAuthenticatedClient(client, true)
      const response =
        expected.method === 'POST'
          ? await client.post(expected.path).json({ seed: true })
          : await client.get(expected.path)
      assert.equal(response.status(), expected.status)
      const expectedBody =
        expected.path === '/api/diagnostics'
          ? {
              ...(expected.body as object),
              server: {
                ...(expected.body as { server: object }).server,
                database: { status: 'ok', schemaVersion: 4 },
              },
            }
          : expected.path.startsWith('/api/state')
            ? (() => {
                const body = structuredClone(expected.body) as AppData
                for (const key of APP_DATA_KEYS)
                  for (const row of body[key]) fillNullableFields(key, row)
                return body
              })()
            : expected.body
      assert.deepEqual(response.body(), expectedBody)
      for (const header of [
        'content-security-policy',
        'cross-origin-opener-policy',
        'cross-origin-resource-policy',
        'referrer-policy',
        'x-content-type-options',
        'x-frame-options',
      ])
        if (expected.headers[header] !== undefined)
          assert.equal(response.header(header), expected.headers[header])
    })
  }

  test('refuses anonymous state and reset, then reports a real signed-in identity', async ({
    client,
    assert,
  }) => {
    const state = await client.get('/api/state')
    state.assertStatus(401)
    const reset = await client.post('/api/test/reset').json({ seed: true })
    reset.assertStatus(401)
    client = await resetAuthenticatedClient(client, true)
    const identity = await client.get('/api/auth/me')
    identity.assertStatus(200)
    assert.equal(identity.body().authMode, 'password-only')
    assert.equal(identity.body().user.email, 'bruce.wayne@wayne.example')
    assert.isFalse(identity.body().canCreateAccount)
    const unscoped = await client.get('/api/state')
    unscoped.assertStatus(200)
    assert.deepEqual(
      unscoped
        .body()
        .accounts.map(({ id }: { id: string }) => id)
        .sort(),
      ['a-loft', 'a-studio']
    )
    const signedReset = await client.post('/api/test/reset').json({ seed: true })
    signedReset.assertStatus(403)
  })

  test('exposes liveness and readiness', async ({ client, assert }) => {
    const live = await client.get('/health/live')
    const ready = await client.get('/health/ready')
    assert.deepEqual(live.body(), { ok: true })
    assert.isTrue(ready.body().isHealthy)
    assert.equal(ready.body().status, 'ok')
    assert.equal(ready.body().checks[0].name, 'Database health check (sqlite)')
  })
})
