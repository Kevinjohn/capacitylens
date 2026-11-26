import { test } from '@japa/runner';
import { complete, keys, smtpOptions } from '#tests/helpers/unit/mail_config';

test.group('mail configuration', () => {
  test('port 465 connects over TLS and every other port must upgrade to it', async ({ assert }) => {
    const implicit = await smtpOptions({ ...complete, CAPACITYLENS_MAIL_PORT: '465' });
    assert.include(implicit, { port: 465, secure: true, requireTLS: false });
    const upgraded = await smtpOptions(complete);
    assert.include(upgraded, { port: 587, secure: false, requireTLS: true });
    for (const options of [implicit, upgraded]) {
      assert.deepEqual(options.tls, { rejectUnauthorized: true });
      assert.deepEqual(options.auth, {
        type: 'login',
        user: 'mailer',
        pass: 'test-mail-password',
      });
    }
  });

  for (const missing of keys.filter((key) => key !== 'CAPACITYLENS_MAIL_HOST')) {
    test(`a mail host without ${missing} refuses to start`, async ({ assert }) => {
      await assert.rejects(
        () => smtpOptions({ ...complete, [missing]: undefined }),
        /Email delivery requires complete CAPACITYLENS_MAIL_HOST, PORT, USER, PASSWORD and FROM/
      );
    });
  }
});
