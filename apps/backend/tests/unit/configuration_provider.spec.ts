import { test } from '@japa/runner'
import env from '#start/env'
import { authMode } from '#services/auth/mode'
import {
  assertM1AuthenticationMode,
  assertProductionPosture,
} from '#providers/configuration_provider'

test('authentication mode accepts the native modes and rejects unknown values', ({ assert }) => {
  assert.doesNotThrow(() => assertM1AuthenticationMode(undefined))
  assert.doesNotThrow(() => assertM1AuthenticationMode(''))
  for (const mode of ['password-only', 'password-and-sso', 'sso-only'])
    assert.doesNotThrow(() => assertM1AuthenticationMode(mode))
  for (const mode of ['off', 'password', 'hosted-oidc-only', 'bogus'])
    assert.throws(() => assertM1AuthenticationMode(mode), /Unknown CAPACITYLENS_MODE/)
})

test('an omitted mode defaults to password authentication', ({ assert }) => {
  const previous = env.get('CAPACITYLENS_MODE')
  try {
    env.set('CAPACITYLENS_MODE', '')
    assert.equal(authMode(), 'password-only')
  } finally {
    env.set('CAPACITYLENS_MODE', previous ?? '')
  }
})

test('production refuses bootstrap, invalid limiter, and audit settings', ({ assert }) => {
  const safe = { mode: 'password-only', allowReset: false, rateLimit: '300', audit: 'on' }
  assert.doesNotThrow(() => assertProductionPosture(safe))
  assert.throws(() => assertProductionPosture({ ...safe, createAdmin: true }), /bootstrap/)
  assert.throws(
    () => assertProductionPosture({ ...safe, bootstrapPassword: 'secret' }),
    /bootstrap/
  )
  for (const rateLimit of ['0', ' 100 ', '1e3', '12.5', '+100', '2000000'])
    assert.throws(() => assertProductionPosture({ ...safe, rateLimit }), /RATE_LIMIT/)
  assert.throws(() => assertProductionPosture({ ...safe, audit: 'off' }), /AUDIT=off/)
  assert.throws(() => assertProductionPosture({ ...safe, allowReset: true }), /ALLOW_RESET/)
})
