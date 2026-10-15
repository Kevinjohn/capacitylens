import { test } from '@japa/runner'
import {
  assertM1AuthenticationMode,
  assertHostedDeploymentProfile,
  assertProductionPosture,
  assertGoogleProviderConfiguration,
} from '#providers/configuration_provider'
import ConfigurationProvider from '#providers/configuration_provider'
import env from '#start/env'
import { authMode, passwordEnabled } from '#services/auth/mode'
import { isTrustedUnsafeOrigin } from '#services/cors_policy'
import { assertPasswordAllowed } from '#services/password_screening'
import { createHash } from 'node:crypto'

type Cleanup = (callback: () => void) => void
type MutableKey =
  | 'CAPACITYLENS_MODE'
  | 'CAPACITYLENS_SECRET'
  | 'CAPACITYLENS_PUBLIC_URL'
  | 'CAPACITYLENS_DEPLOYMENT_PROFILE'
  | 'CAPACITYLENS_ALLOW_OPEN_SIGNUP'
  | 'CAPACITYLENS_SETUP_TOKEN'
  | 'CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION'
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

test('auth mode validation accepts all product modes and rejects unknown values', ({ assert }) => {
  for (const mode of [undefined, 'off', 'password-only', 'password-and-sso', 'sso-only'])
    assert.doesNotThrow(() => assertM1AuthenticationMode(mode))
  assert.throws(() => assertM1AuthenticationMode('password'), /Unknown CAPACITYLENS_MODE/)
  assert.throws(() => assertM1AuthenticationMode('unexpected'), /Unknown CAPACITYLENS_MODE/)
})

test('provider modes refuse either half of Google credentials', ({ assert }) => {
  for (const mode of ['password-and-sso', 'sso-only']) {
    for (const credentials of [{ clientId: 'google-id' }, { clientSecret: 'google-secret' }])
      assert.throws(
        () => assertGoogleProviderConfiguration({ mode, ...credentials }),
        /both client ID and secret/
      )
    assert.doesNotThrow(() => assertGoogleProviderConfiguration({ mode }))
    assert.doesNotThrow(() =>
      assertGoogleProviderConfiguration({
        mode,
        clientId: 'google-id',
        clientSecret: 'google-secret',
      })
    )
  }
  assert.doesNotThrow(() =>
    assertGoogleProviderConfiguration({ mode: 'password-only', clientId: 'google-id' })
  )
})

test('hosted SSO profile requires complete Google configuration', ({ assert }) => {
  const base = { profile: 'hosted-sso-only', mode: 'sso-only' }
  const google = { googleClientId: 'google-id', googleClientSecret: 'private-google-secret' }
  const microsoft = {
    microsoftClientId: 'microsoft-id',
    microsoftClientSecret: 'private-microsoft-secret',
    microsoftTenantId: '01234567-89ab-cdef-0123-456789abcdef',
  }

  assert.doesNotThrow(() => assertHostedDeploymentProfile({ ...base, ...google }))
  assert.throws(
    () => assertHostedDeploymentProfile({ ...base, ...microsoft }),
    /complete Google provider/
  )
  assert.doesNotThrow(() => assertHostedDeploymentProfile({ ...base, ...google, ...microsoft }))
  assert.throws(
    () => assertHostedDeploymentProfile({ ...base, googleClientId: 'only-half-configured' }),
    /complete Google provider/
  )
  assert.throws(
    () => assertHostedDeploymentProfile({ ...base, mode: 'password-only', ...google }),
    /requires sso-only mode/
  )
  assert.throws(
    () => assertHostedDeploymentProfile({ ...base, allowOpenSignup: true, ...google }),
    /forbids open signup/
  )
  const setupError = thrownBy(() =>
    assertHostedDeploymentProfile({ ...base, setupToken: 'secret-setup-token', ...google })
  )
  assert.match(setupError.message, /password-account configuration/)
  assert.notInclude(setupError.message, 'secret-setup-token')
})

test('runtime password availability follows off, password, mixed, and SSO-only modes', ({
  assert,
  cleanup,
}) => {
  captureEnvironment(cleanup, ['CAPACITYLENS_MODE'])
  for (const [mode, enabled] of [
    ['off', false],
    ['password-only', true],
    ['password-and-sso', true],
    ['sso-only', false],
  ] as const) {
    setEnvironment('CAPACITYLENS_MODE', mode)
    assert.equal(authMode(), mode)
    assert.equal(passwordEnabled(), enabled)
  }
})

test('password mode requires a 32-character secret and a bare public HTTP(S) origin', async ({
  assert,
  cleanup,
}) => {
  captureEnvironment(cleanup, [
    'CAPACITYLENS_MODE',
    'CAPACITYLENS_SECRET',
    'CAPACITYLENS_PUBLIC_URL',
    'CAPACITYLENS_ALLOW_RESET',
    'CAPACITYLENS_DEPLOYMENT_PROFILE',
    'CAPACITYLENS_ALLOW_OPEN_SIGNUP',
    'CAPACITYLENS_SETUP_TOKEN',
  ])
  enablePasswordConfiguration()
  setEnvironment('CAPACITYLENS_DEPLOYMENT_PROFILE', '')
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

test('production refuses open mode, bootstrap credentials, invalid limits, audit-off, and reset', ({
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
  assert.throws(
    () => assertProductionPosture({ ...safe, mode: 'off', allowOpen: false }),
    /ALLOW_OPEN_IN_PRODUCTION/
  )
  assert.doesNotThrow(() => assertProductionPosture({ ...safe, mode: 'off', allowOpen: true }))
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
    'CAPACITYLENS_DEPLOYMENT_PROFILE',
    'CAPACITYLENS_ALLOW_OPEN_SIGNUP',
    'CAPACITYLENS_SETUP_TOKEN',
    'CAPACITYLENS_ALLOW_RESET',
    'CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION',
    'CAPACITYLENS_CREATE_ADMIN_ADMIN',
    'CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD',
    'CAPACITYLENS_RATE_LIMIT',
    'CAPACITYLENS_AUDIT',
  ])
  enablePasswordConfiguration()
  setEnvironment('CAPACITYLENS_DEPLOYMENT_PROFILE', '')
  setEnvironment('CAPACITYLENS_ALLOW_OPEN_SIGNUP', false)
  setEnvironment('CAPACITYLENS_SETUP_TOKEN', '')
  setEnvironment('CAPACITYLENS_ALLOW_RESET', true)
  setEnvironment('CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION', false)
  setEnvironment('CAPACITYLENS_CREATE_ADMIN_ADMIN', false)
  setEnvironment('CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD', '')
  setEnvironment('CAPACITYLENS_RATE_LIMIT', '100')
  setEnvironment('CAPACITYLENS_AUDIT', 'on')
  const production = new ConfigurationProvider({ inProduction: true } as never)
  await assert.rejects(() => production.boot(), /ALLOW_RESET/)

  setEnvironment('CAPACITYLENS_MODE', 'off')
  setEnvironment('CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION', true)
  setEnvironment('CAPACITYLENS_CREATE_ADMIN_ADMIN', true)
  setEnvironment('CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD', 'development-only-password')
  setEnvironment('CAPACITYLENS_RATE_LIMIT', 'invalid')
  setEnvironment('CAPACITYLENS_AUDIT', 'off')
  const development = new ConfigurationProvider({ inProduction: false } as never)
  await assert.doesNotReject(() => development.boot())
})

test('proxy protocol headers affect origin checks only when proxy trust is enabled', ({
  assert,
}) => {
  const request = {
    origin: 'http://capacity.example.test',
    host: 'capacity.example.test',
    protocol: 'https',
    forwardedProtocol: 'http',
  }
  assert.isFalse(isTrustedUnsafeOrigin({ ...request, trustProxy: false }))
  assert.isTrue(isTrustedUnsafeOrigin({ ...request, trustProxy: true }))
  assert.isFalse(
    isTrustedUnsafeOrigin({
      ...request,
      host: 'attacker.example.test',
      trustProxy: true,
    })
  )
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
