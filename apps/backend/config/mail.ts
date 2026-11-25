import env from '#start/env';
import { defineConfig, transports } from '@adonisjs/mail';
import type { InferMailers } from '@adonisjs/mail/types';

const host = env.get('CAPACITYLENS_MAIL_HOST')?.trim();
const from = env.get('CAPACITYLENS_MAIL_FROM')?.trim();
const user = env.get('CAPACITYLENS_MAIL_USER')?.trim();
const password = env.get('CAPACITYLENS_MAIL_PASSWORD')?.release();
const port = Number(env.get('CAPACITYLENS_MAIL_PORT'));

if (
  host &&
  (!from ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from) ||
    !user ||
    !password ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535)
) {
  throw new Error(
    'Email delivery requires complete CAPACITYLENS_MAIL_HOST, PORT, USER, PASSWORD and FROM settings.'
  );
}

// The Postmark transport is unsupported because it is incompatible with Nodemailer 10.
const mailConfig = defineConfig({
  default: 'smtp',
  from: from ?? 'noreply@capacitylens.local',
  mailers: {
    smtp: transports.smtp({
      host: host ?? 'localhost',
      port: host ? port : 25,
      secure: port === 465,
      requireTLS: Boolean(host && port !== 465),
      auth: host ? { type: 'login', user: user!, pass: password! } : undefined,
      tls: { rejectUnauthorized: true },
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      socketTimeout: 10_000,
    }),
  },
});

export default mailConfig;

declare module '@adonisjs/mail/types' {
  export interface MailersList extends InferMailers<typeof mailConfig> {}
}
