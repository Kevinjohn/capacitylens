import { test } from '@japa/runner'
import {
  assertM1AuthenticationMode,
  assertProductionPosture,
} from '#providers/configuration_provider'

test('M1 accepts only the trusted-local off authentication mode', ({ assert }) => {
  assert.doesNotThrow(() => assertM1AuthenticationMode(undefined))
  assert.doesNotThrow(() => assertM1AuthenticationMode('off'))
  for (const mode of ['password', 'password-only', 'sso-only'])
    assert.throws(() => assertM1AuthenticationMode(mode), /not available in the M1 backend/)
})

test('production refuses unsafe open, bootstrap, limiter, and audit settings', ({ assert }) => {
  const safe = { mode: 'off', allowOpen: true, allowReset: false, rateLimit: '300', audit: 'on' }
  assert.doesNotThrow(() => assertProductionPosture(safe))
  assert.throws(() => assertProductionPosture({ ...safe, allowOpen: false }), /ALLOW_OPEN/)
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
