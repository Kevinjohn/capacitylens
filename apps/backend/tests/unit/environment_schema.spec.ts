import { test } from '@japa/runner';
import { envSchema } from '#start/env';

test('operator numeric settings reject malformed and out-of-range input', ({ assert }) => {
  for (const key of [
    'CAPACITYLENS_MAIL_PORT',
    'CAPACITYLENS_TEST_HTTP_PORT',
    'CAPACITYLENS_RATE_LIMIT',
  ] as const) {
    const validate = envSchema[key];
    assert.isUndefined(validate(key, undefined));
    assert.isUndefined(validate(key, ''));
    assert.equal(validate(key, '300'), '300');
    for (const value of ['-1', ' 100 ', '1e3', '12.5', '+100', '1000001'])
      assert.throws(() => validate(key, value), key);
  }
  assert.equal(envSchema.CAPACITYLENS_RATE_LIMIT('CAPACITYLENS_RATE_LIMIT', '0'), '0');
  assert.throws(() => envSchema.CAPACITYLENS_MAIL_PORT('CAPACITYLENS_MAIL_PORT', '0'));
  assert.throws(() => envSchema.CAPACITYLENS_MAIL_PORT('CAPACITYLENS_MAIL_PORT', '65536'));
});

test('typed switches and SMTP addresses reject unsupported supplied values', ({ assert }) => {
  assert.throws(() => envSchema.CAPACITYLENS_LOG('CAPACITYLENS_LOG', 'verbose'));
  assert.throws(() => envSchema.CAPACITYLENS_AUDIT('CAPACITYLENS_AUDIT', 'disabled'));
  assert.throws(() => envSchema.CAPACITYLENS_MAIL_FROM('CAPACITYLENS_MAIL_FROM', 'invalid'));
  assert.throws(() =>
    envSchema.CAPACITYLENS_MAIL_HOST('CAPACITYLENS_MAIL_HOST', 'https://smtp.example.com')
  );
  // Backup retention deliberately belongs to its warning/default/clamp parser.
  assert.equal(
    envSchema.CAPACITYLENS_BACKUP_KEEP('CAPACITYLENS_BACKUP_KEEP', 'invalid'),
    'invalid'
  );
});
