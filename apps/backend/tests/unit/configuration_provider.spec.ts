import { test } from '@japa/runner'
import { assertProductionPosture } from '#providers/configuration_provider'

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
