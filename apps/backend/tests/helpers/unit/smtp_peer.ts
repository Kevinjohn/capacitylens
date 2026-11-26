import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer, type TLSSocket } from 'node:tls';
import type { AddressInfo } from 'node:net';

// Serves only `smtp_compatibility.spec.ts`, the dependency canary; delete the two together.

/** A local authenticated TLS peer exercises the supported SMTP adapter without outbound mail. */
export async function createSmtpFixture(directory: string) {
  const key = join(directory, 'key.pem');
  const cert = join(directory, 'cert.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-keyout',
      key,
      '-out',
      cert,
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ],
    { stdio: 'ignore' }
  );
  const ca = await readFile(cert);
  const sockets = new Set<TLSSocket>();
  const messages: string[] = [];
  const recipients: string[] = [];
  let authenticated = 0;
  const server = createServer({ key: await readFile(key), cert: ca }, (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.setEncoding('utf8');
    socket.write('220 localhost test SMTP\r\n');
    let buffer = '';
    let content: string[] | null = null;
    let authorized = false;
    socket.on('data', (chunk) => {
      buffer += String(chunk);
      let end: number;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (content) {
          if (line === '.') {
            messages.push(content.join('\r\n'));
            content = null;
            socket.write('250 2.0.0 accepted\r\n');
          } else content.push(line);
        } else if (/^(EHLO|HELO)/.test(line)) socket.write('250-localhost\r\n250 AUTH PLAIN\r\n');
        else if (line.startsWith('AUTH PLAIN ')) {
          authorized =
            Buffer.from(line.slice(11), 'base64').toString() === '\0mailer\0smtp-test-password';
          if (authorized) authenticated++;
          socket.write(
            authorized ? '235 Authentication successful\r\n' : '535 Authentication failed\r\n'
          );
        } else if (line === 'QUIT') socket.end('221 Bye\r\n');
        else if (!authorized) socket.write('530 Authentication required\r\n');
        else if (line.startsWith('RCPT TO:')) {
          recipients.push(line);
          socket.write(
            line.includes('blocked@wayne.example') ? '550 Recipient refused\r\n' : '250 OK\r\n'
          );
        } else if (line === 'DATA') {
          content = [];
          socket.write('354 Send message\r\n');
        } else socket.write('250 OK\r\n');
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    ca,
    messages,
    recipients,
    authenticated: () => authenticated,
    port: (server.address() as AddressInfo).port,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    },
  };
}
