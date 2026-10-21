import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import testUtils from '@adonisjs/core/services/test_utils'
import app from '@adonisjs/core/services/app'
import { defineConfig } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { hashPassword } from '#services/password_service'

type Cleanup = (callback: () => void) => void
type MutableKey =
  | 'CAPACITYLENS_MODE'
  | 'CAPACITYLENS_RATE_LIMIT'
  | 'CAPACITYLENS_SECRET'
  | 'CAPACITYLENS_PUBLIC_URL'

function captureEnvironment(cleanup: Cleanup, keys: MutableKey[]) {
  const previous = new Map(keys.map((key) => [key, env.get(key)]))
  cleanup(() => {
    for (const [key, value] of previous) env.set(key, value ?? '')
  })
}

function setEnvironment(key: MutableKey, value: string) {
  env.set(key, value)
}

/** Proxy trust is read once at boot, so tests switch the booted server's setting directly. */
const httpConfig = () => app.config.get<ReturnType<typeof defineConfig>>('app.http')

function trustProxyHeaders(trusted: boolean) {
  httpConfig().trustProxy = trusted ? defineConfig({}).trustProxy : () => false
}

async function requestMetadata(client: ApiClient, forwardedIp?: string) {
  const request = client.get('/api/meta')
  if (forwardedIp) request.header('x-forwarded-for', forwardedIp)
  return request.send()
}

async function responseStatus(response: Promise<{ status(): number }>) {
  const resolvedResponse = await response
  return resolvedResponse.status()
}

async function signIn(
  client: ApiClient,
  forwardedIp?: string,
  email = 'private-limit@example.test'
) {
  const request = client.post('/api/auth/sign-in')
  if (forwardedIp) request.header('x-forwarded-for', forwardedIp)
  return request.json({ email, password: 'never-store-this-password-012345' }).send()
}

test.group('native auth and API rate limits', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(async () => {
    await db.from('rate_limits').delete()
    const bootedTrust = httpConfig().trustProxy
    return () => {
      httpConfig().trustProxy = bootedTrust
    }
  })

  test('configured API limit returns JSON 429 while health stays exempt', async ({
    client,
    assert,
    cleanup,
  }) => {
    captureEnvironment(cleanup, ['CAPACITYLENS_MODE', 'CAPACITYLENS_RATE_LIMIT'])
    setEnvironment('CAPACITYLENS_MODE', 'off')
    setEnvironment('CAPACITYLENS_RATE_LIMIT', '2')

    assert.equal(await responseStatus(requestMetadata(client)), 200)
    assert.equal(await responseStatus(requestMetadata(client)), 200)
    const limited = await requestMetadata(client)
    assert.equal(limited.status(), 429)
    assert.deepEqual(limited.body(), { error: 'Rate limit exceeded.' })
    const persistedLimits = await db.from('rate_limits').select('key', 'points')
    assert.isNotEmpty(persistedLimits, 'the native database limiter records the client bucket')
    for (const limit of persistedLimits) {
      assert.isAbove(Number(limit.points), 0)
      assert.match(String(limit.key), /^rlflx:api:[a-f0-9]{64}$/)
    }

    for (let attempt = 0; attempt < 5; attempt++)
      assert.equal(await responseStatus(client.get('/api/health').send()), 200)
  })

  test('API rate limiting is disabled when unset, zero, or malformed', async ({
    client,
    assert,
    cleanup,
  }) => {
    captureEnvironment(cleanup, ['CAPACITYLENS_MODE', 'CAPACITYLENS_RATE_LIMIT'])
    setEnvironment('CAPACITYLENS_MODE', 'off')
    for (const configured of ['', '0', '-1', '1.5', 'invalid', ' 2 ']) {
      await db.from('rate_limits').delete()
      setEnvironment('CAPACITYLENS_RATE_LIMIT', configured)
      for (let attempt = 0; attempt < 4; attempt++)
        assert.equal(await responseStatus(requestMetadata(client)), 200, `setting ${configured}`)
    }
  })

  test('forwarded client identity is ignored unless proxy headers are explicitly trusted', async ({
    client,
    assert,
    cleanup,
  }) => {
    captureEnvironment(cleanup, ['CAPACITYLENS_MODE', 'CAPACITYLENS_RATE_LIMIT'])
    setEnvironment('CAPACITYLENS_MODE', 'off')
    setEnvironment('CAPACITYLENS_RATE_LIMIT', '2')
    trustProxyHeaders(false)
    assert.equal(await responseStatus(requestMetadata(client, '203.0.113.41')), 200)
    assert.equal(await responseStatus(requestMetadata(client, '203.0.113.42')), 200)
    assert.equal(await responseStatus(requestMetadata(client, '203.0.113.43')), 429)

    await db.from('rate_limits').delete()
    trustProxyHeaders(true)
    assert.equal(await responseStatus(requestMetadata(client, '203.0.113.41')), 200)
    assert.equal(await responseStatus(requestMetadata(client, '203.0.113.42')), 200)
    assert.equal(await responseStatus(requestMetadata(client, '203.0.113.41')), 200)
    assert.equal(await responseStatus(requestMetadata(client, '203.0.113.41')), 429)
  })

  test('failed sign-in attempts are bounded by client and limiter records omit credentials', async ({
    client,
    assert,
    cleanup,
  }) => {
    captureEnvironment(cleanup, [
      'CAPACITYLENS_MODE',
      'CAPACITYLENS_RATE_LIMIT',
      'CAPACITYLENS_SECRET',
      'CAPACITYLENS_PUBLIC_URL',
    ])
    setEnvironment('CAPACITYLENS_MODE', 'password-only')
    setEnvironment('CAPACITYLENS_RATE_LIMIT', '0')
    trustProxyHeaders(true)
    setEnvironment('CAPACITYLENS_SECRET', 'n'.repeat(32))
    setEnvironment('CAPACITYLENS_PUBLIC_URL', 'https://capacity.example.test')

    const email = `private-${crypto.randomUUID()}@example.test`
    const forwardedIp = `198.51.100.${Math.floor(Math.random() * 200) + 1}`
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await signIn(client, forwardedIp, email)
      assert.equal(response.status(), 401)
      assert.notInclude(JSON.stringify(response.body()), email)
      assert.notInclude(JSON.stringify(response.body()), 'never-store-this-password-012345')
    }
    const blocked = await signIn(client, forwardedIp, email)
    assert.equal(blocked.status(), 429)
    assert.notInclude(JSON.stringify(blocked.body()), email)
    assert.notInclude(JSON.stringify(blocked.body()), 'never-store-this-password-012345')

    const nextClient = await signIn(client, '198.51.100.240', email)
    assert.equal(nextClient.status(), 401)
    const entries = await db.from('rate_limits').select('key')
    assert.isNotEmpty(entries)
    for (const entry of entries) {
      assert.notInclude(String(entry.key), email)
      assert.notInclude(String(entry.key), 'never-store-this-password-012345')
    }
  })

  test('an unknown address waits for the same password work as a real account', async ({
    client,
    assert,
    cleanup,
  }) => {
    captureEnvironment(cleanup, ['CAPACITYLENS_MODE', 'CAPACITYLENS_RATE_LIMIT'])
    setEnvironment('CAPACITYLENS_MODE', 'password-only')
    setEnvironment('CAPACITYLENS_RATE_LIMIT', '0')

    // Two active and sixteen queued derivations fill the queue, so any sign-in that derives is refused.
    const saturating = Array.from({ length: 18 }, (_, index) => hashPassword(`saturate-${index}`))
    const unknown = await signIn(client, undefined, `nobody-${crypto.randomUUID()}@example.test`)
    await Promise.all(saturating)
    assert.equal(unknown.status(), 503)
  }).timeout(20_000)
})
