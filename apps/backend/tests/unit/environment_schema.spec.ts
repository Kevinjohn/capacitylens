import { test } from '@japa/runner'
import { envSchema } from '#start/env'

test.group('environment schema', () => {
  test('operator numeric settings reject malformed and out-of-range input', ({ assert }) => {
    for (const key of [
      'CAPACITYLENS_MAIL_PORT',
      'CAPACITYLENS_TEST_HTTP_PORT',
      'CAPACITYLENS_RATE_LIMIT',
    ] as const) {
      const validate = envSchema[key]
      assert.isUndefined(validate(key, undefined))
      assert.isUndefined(validate(key, ''))
      assert.equal(validate(key, '300'), '300')
      for (const value of ['-1', ' 100 ', '1e3', '12.5', '+100', '1000001'])
        assert.throws(() => validate(key, value), key)
    }
    assert.equal(envSchema.CAPACITYLENS_RATE_LIMIT('CAPACITYLENS_RATE_LIMIT', '0'), '0')
    assert.throws(() => envSchema.CAPACITYLENS_MAIL_PORT('CAPACITYLENS_MAIL_PORT', '0'))
    assert.throws(() => envSchema.CAPACITYLENS_MAIL_PORT('CAPACITYLENS_MAIL_PORT', '65536'))
  })

  test('typed switches and SMTP addresses reject unsupported supplied values', ({ assert }) => {
    assert.throws(() => envSchema.CAPACITYLENS_LOG('CAPACITYLENS_LOG', 'verbose'))
    assert.throws(() => envSchema.CAPACITYLENS_MAIL_FROM('CAPACITYLENS_MAIL_FROM', 'invalid'))
    assert.throws(() =>
      envSchema.CAPACITYLENS_MAIL_HOST('CAPACITYLENS_MAIL_HOST', 'https://smtp.example.com')
    )
    // Backup retention deliberately belongs to its warning/default/clamp parser.
    assert.equal(
      envSchema.CAPACITYLENS_BACKUP_KEEP('CAPACITYLENS_BACKUP_KEEP', 'invalid'),
      'invalid'
    )
  })

  test('proxy trust keeps boolean values loopback-only and accepts private', ({ assert }) => {
    const key = 'CAPACITYLENS_TRUST_PROXY_HEADERS'
    const validate = envSchema[key]
    for (const value of [undefined, '', 'false', '0']) assert.equal(validate(key, value), 'off')
    for (const value of ['true', '1']) assert.equal(validate(key, value), 'loopback')
    assert.equal(validate(key, 'private'), 'private')
    for (const value of ['yes', 'PRIVATE', 'all', ' private'])
      assert.throws(() => validate(key, value), key)
  })

  test('a pinned browser-test date must be a real calendar date', ({ assert }) => {
    const key = 'CAPACITYLENS_FIXED_TODAY'
    assert.isUndefined(envSchema[key](key, undefined))
    assert.isUndefined(envSchema[key](key, ''))
    assert.equal(envSchema[key](key, '2026-06-03'), '2026-06-03')
    for (const value of ['2026-02-30', '2026-6-3', 'today'])
      assert.throws(() => envSchema[key](key, value), key)
  })

  test('passwords are secrets that stay out of logs and stringification', ({ assert }) => {
    for (const key of [
      'CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD',
      'CAPACITYLENS_MAIL_PASSWORD',
    ] as const) {
      assert.isUndefined(envSchema[key](key, undefined))
      assert.isUndefined(envSchema[key](key, ''))
      const secret = envSchema[key](key, 'wayne-manor-2026')!
      assert.equal(secret.release(), 'wayne-manor-2026')
      assert.notInclude(String(secret), 'wayne-manor-2026')
      assert.notInclude(JSON.stringify({ secret }), 'wayne-manor-2026')
    }
  })
})
