import { mock } from 'node:test';
import { test } from '@japa/runner';
import { transports } from '@adonisjs/mail';
import env from '#start/env';
import { setSecretSetting } from '#tests/helpers/secret_settings';

const keys = [
  'CAPACITYLENS_MAIL_HOST',
  'CAPACITYLENS_MAIL_PORT',
  'CAPACITYLENS_MAIL_USER',
  'CAPACITYLENS_MAIL_PASSWORD',
  'CAPACITYLENS_MAIL_FROM',
] as const;
type MailSettings = Partial<Record<(typeof keys)[number], string>>;

const complete: MailSettings = {
  CAPACITYLENS_MAIL_HOST: 'smtp.wayne.example',
  CAPACITYLENS_MAIL_PORT: '587',
  CAPACITYLENS_MAIL_USER: 'mailer',
  CAPACITYLENS_MAIL_PASSWORD: 'test-mail-password',
  CAPACITYLENS_MAIL_FROM: 'alfred@wayne.example',
};

/** Loads `config/mail.ts` afresh under `settings` and returns the options it gives the SMTP transport. */
async function smtpOptions(settings: MailSettings) {
  const previous = keys.map((key) => [key, env.get(key), process.env[key]] as const);
  const smtp = mock.method(transports, 'smtp');
  try {
    for (const key of keys) {
      if (key === 'CAPACITYLENS_MAIL_PASSWORD') setSecretSetting(key, settings[key]);
      else env.set(key, (settings[key] ?? '') as never);
    }
    const url = new URL(`../../config/mail.ts?mail-config=${Math.random()}`, import.meta.url);
    await import(url.href);
    return smtp.mock.calls[0]!.arguments[0] as Record<string, unknown>;
  } finally {
    smtp.mock.restore();
    for (const [key, value, raw] of previous) {
      env.set(key, value as never);
      if (raw === undefined) delete process.env[key];
      else process.env[key] = raw;
    }
  }
}

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
