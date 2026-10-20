import { test } from '@japa/runner'
import { readFile } from 'node:fs/promises'
import testUtils from '@adonisjs/core/services/test_utils'
import { replaceWithSeed } from '#services/state_repository'
import { APP_DATA_KEYS, type AppData } from '@capacitylens/shared/types/entities'
import { fillNullableFields } from '@capacitylens/shared/types/nullableFields'

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
  group.setup(() => testUtils.db().migrate())
  group.each.setup(() => replaceWithSeed())
  for (const expected of fixture.responses) {
    test(`${expected.method} ${expected.path} matches the main response`, async ({
      client,
      assert,
    }) => {
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

  test('boots the SPA in trusted-local mode', async ({ client, assert }) => {
    const response = await client.get('/api/auth/me')
    assert.deepEqual(response.body(), {
      authMode: 'off',
      user: {
        id: 'demo',
        name: 'Demo',
        email: 'demo@capacitylens.local',
        emailVerified: true,
        image: null,
      },
      providers: [],
      canCreateAccount: false,
    })
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
