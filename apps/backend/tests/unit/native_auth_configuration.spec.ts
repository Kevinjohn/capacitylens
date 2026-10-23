import { test } from '@japa/runner'
import { assertProductionPosture } from '#providers/configuration_provider'
import ConfigurationProvider from '#providers/configuration_provider'
import env from '#start/env'
import { assertPasswordAllowed } from '#services/password_screening'
import { createHash } from 'node:crypto'

type Cleanup = (callback: () => void) => void
type MutableKey =
  | 'CAPACITYLENS_MODE'
  | 'CAPACITYLENS_SECRET'
  | 'CAPACITYLENS_PUBLIC_URL'
  | 'CAPACITYLENS_ALLOW_OPEN_SIGNUP'
  | 'CAPACITYLENS_SETUP_TOKEN'
  | 'CAPACITYLENS_ALLOW_RESET'
  | 'CAPACITYLENS_CREATE_ADMIN_ADMIN'
  | 'CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD'
  | 'CAPACITYLENS_RATE_LIMIT'
  | 'CAPACITYLENS_AUDIT'
  | 'CAPACITYLENS_PASSWORD_BREACH_CHECK'
  | 'NODE_ENV'

function captureEnvironment(cleanup: Cleanup, keys: MutableKey[]) {
  const previous = new Map(keys.map((key) => [key, env.get(key)]))
  cleanup(() => {
    for (const [key, value] of previous) env.set(key, value ?? '')
  })
}

function setEnvironment(key: MutableKey, value: string | boolean) {
  env.set(key, value)
}

function thrownBy(operation: () => unknown) {
  try {
    operation()
  } catch (error) {
    if (error instanceof Error) return error
    throw error
  }
  throw new Error('Expected the operation to throw.')
}

function enablePasswordConfiguration(publicUrl = 'https://capacity.example.test') {
  setEnvironment('CAPACITYLENS_MODE', 'password-only')
  setEnvironment('CAPACITYLENS_SECRET', 's'.repeat(32))
  setEnvironment('CAPACITYLENS_PUBLIC_URL', publicUrl)
  setEnvironment('CAPACITYLENS_ALLOW_RESET', false)
}

test('password mode requires a 32-character secret and a bare public HTTP(S) origin', async ({
  assert,
  cleanup,
}) => {
  captureEnvironment(cleanup, [
    'CAPACITYLENS_MODE',
    'CAPACITYLENS_SECRET',
    'CAPACITYLENS_PUBLIC_URL',
    'CAPACITYLENS_ALLOW_RESET',
    'CAPACITYLENS_ALLOW_OPEN_SIGNUP',
    'CAPACITYLENS_SETUP_TOKEN',
  ])
  enablePasswordConfiguration()
  setEnvironment('CAPACITYLENS_ALLOW_OPEN_SIGNUP', false)
  setEnvironment('CAPACITYLENS_SETUP_TOKEN', '')
  const provider = new ConfigurationProvider({ inProduction: false } as never)
  await assert.doesNotReject(() => provider.boot())

  for (const url of [
    'https://user:password@capacity.example.test',
    'https://capacity.example.test/path',
    'https://capacity.example.test?query=1',
    'https://capacity.example.test#fragment',
    'ftp://capacity.example.test',
  ]) {
    setEnvironment('CAPACITYLENS_PUBLIC_URL', url)
    await assert.rejects(() => provider.boot(), /bare HTTP\(S\) origin/)
  }

  setEnvironment('CAPACITYLENS_SECRET', 'short-secret')
  await assert.rejects(() => provider.boot(), /at least 32 characters/)
})

test('production refuses bootstrap credentials, invalid limits, audit-off, and reset', ({
  assert,
}) => {
  const safe = {
    mode: 'password-only',
    allowOpen: false,
    allowReset: false,
    rateLimit: '100',
    audit: 'on',
  }
  assert.doesNotThrow(() => assertProductionPosture(safe))
  assert.doesNotThrow(() => assertProductionPosture({ ...safe, rateLimit: '1000000' }))
  assert.throws(() => assertProductionPosture({ ...safe, createAdmin: true }), /bootstrap/)
  const secret = 'private-bootstrap-password'
  const bootstrapError = thrownBy(() =>
    assertProductionPosture({ ...safe, bootstrapPassword: secret })
  )
  assert.match(bootstrapError.message, /bootstrap/)
  assert.notInclude(bootstrapError.message, secret)
  for (const rateLimit of ['0', '-1', '12.5', ' 100 ', '1e3', '1000001'])
    assert.throws(() => assertProductionPosture({ ...safe, rateLimit }), /RATE_LIMIT/)
  assert.throws(() => assertProductionPosture({ ...safe, audit: 'off' }), /AUDIT=off/)
  assert.throws(() => assertProductionPosture({ ...safe, allowReset: true }), /ALLOW_RESET/)
})

test('production boot refuses reset while non-production boot keeps the test flag available', async ({
  assert,
  cleanup,
}) => {
  captureEnvironment(cleanup, [
    'CAPACITYLENS_MODE',
    'CAPACITYLENS_SECRET',
    'CAPACITYLENS_PUBLIC_URL',
    'CAPACITYLENS_ALLOW_OPEN_SIGNUP',
    'CAPACITYLENS_SETUP_TOKEN',
    'CAPACITYLENS_ALLOW_RESET',
    'CAPACITYLENS_CREATE_ADMIN_ADMIN',
    'CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD',
    'CAPACITYLENS_RATE_LIMIT',
    'CAPACITYLENS_AUDIT',
  ])
  enablePasswordConfiguration()
  setEnvironment('CAPACITYLENS_ALLOW_OPEN_SIGNUP', false)
  setEnvironment('CAPACITYLENS_SETUP_TOKEN', '')
  setEnvironment('CAPACITYLENS_ALLOW_RESET', true)
  setEnvironment('CAPACITYLENS_CREATE_ADMIN_ADMIN', false)
  setEnvironment('CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD', '')
  setEnvironment('CAPACITYLENS_RATE_LIMIT', '100')
  setEnvironment('CAPACITYLENS_AUDIT', 'on')
  const production = new ConfigurationProvider({ inProduction: true } as never)
  await assert.rejects(() => production.boot(), /ALLOW_RESET/)

  setEnvironment('CAPACITYLENS_MODE', 'password-only')
  setEnvironment('CAPACITYLENS_CREATE_ADMIN_ADMIN', true)
  setEnvironment('CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD', 'development-only-password')
  setEnvironment('CAPACITYLENS_RATE_LIMIT', 'invalid')
  setEnvironment('CAPACITYLENS_AUDIT', 'off')
  const development = new ConfigurationProvider({ inProduction: false } as never)
  await assert.doesNotReject(() => development.boot())
})

test('production screens passwords by default and only skips screening after explicit opt-out', async ({
  assert,
  cleanup,
}) => {
  captureEnvironment(cleanup, ['NODE_ENV', 'CAPACITYLENS_PASSWORD_BREACH_CHECK'])
  setEnvironment('NODE_ENV', 'production')
  setEnvironment('CAPACITYLENS_PASSWORD_BREACH_CHECK', '')
  const password = 'unique-safe-password-for-production-2026'
  const digest = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase()
  const originalFetch = globalThis.fetch
  let calls = 0
  let url = ''
  globalThis.fetch = (async (input) => {
    calls++
    url = String(input)
    return new Response(`${'A'.repeat(35)}:0\r\n`)
  }) as typeof fetch
  cleanup(() => {
    globalThis.fetch = originalFetch
  })

  await assertPasswordAllowed(password)
  assert.equal(calls, 1)
  assert.isTrue(url.endsWith(digest.slice(0, 5)))
  assert.notInclude(url, password)
  assert.notInclude(url, digest)

  setEnvironment('CAPACITYLENS_PASSWORD_BREACH_CHECK', false)
  calls = 0
  await assertPasswordAllowed(password)
  assert.equal(calls, 0)
})
