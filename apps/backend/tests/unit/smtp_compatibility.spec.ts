import { test } from '@japa/runner';
import { SMTPTransport } from '@adonisjs/mail/transports/smtp';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSmtpFixture } from '#tests/helpers/unit/smtp_peer';

// Dependency canary for the `@adonisjs/mail>nodemailer` override in `pnpm-workspace.yaml`: it
// imports nothing from the product and proves only that the overridden Nodemailer still works
// with the mail package's SMTP adapter. Delete this file and `tests/helpers/unit/smtp_peer.ts`
// together with that override. The product's own mail settings are tested in `mail_config.spec.ts`.

test('supported SMTP adapter authenticates over trusted TLS, sends attachments and surfaces refusals', async ({
  assert,
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'capacitylens-smtp-'));
  const peer = await createSmtpFixture(directory);
  const config = {
    host: '127.0.0.1',
    port: peer.port,
    secure: true,
    auth: { type: 'login' as const, user: 'mailer', pass: 'smtp-test-password' },
    tls: { ca: peer.ca, servername: 'localhost' },
    pool: true,
    maxConnections: 1,
    maxMessages: 1,
    connectionTimeout: 2000,
    greetingTimeout: 2000,
    socketTimeout: 2000,
  };
  const transport = new SMTPTransport(config);
  const rejected = new SMTPTransport({
    ...config,
    auth: { ...config.auth, pass: 'wrong-password' },
  });
  const message = {
    from: 'bruce.wayne@wayne.example',
    to: [{ address: 'clark.kent@wayne.example', name: 'Clark Kent' }],
    subject: 'Recovery compatibility',
    text: 'Recovery mail compatibility',
    attachments: [
      { filename: 'recovery_note.txt', content: Buffer.from('Wayne recovery attachment') },
    ],
  };
  try {
    const response = await transport.send(message);
    assert.isNotEmpty(response.messageId);
    assert.equal(peer.messages.length, 1);
    assert.isAbove(peer.authenticated(), 0);
    assert.match(peer.recipients[0], /clark.kent@wayne.example/);
    assert.include(peer.messages[0], 'recovery_note.txt');
    assert.include(peer.messages[0], Buffer.from('Wayne recovery attachment').toString('base64'));
    await assert.rejects(
      () =>
        transport.send({
          ...message,
          to: [{ address: 'blocked@wayne.example', name: 'Clark Kent' }],
        }),
      /550|Recipient refused/
    );
    await assert.rejects(() => rejected.send(message), /535|Authentication failed/);
    assert.equal(peer.messages.length, 1);
  } finally {
    await transport.close();
    await rejected.close();
    await peer.close();
    await rm(directory, { recursive: true, force: true });
  }
}).timeout(15000);
