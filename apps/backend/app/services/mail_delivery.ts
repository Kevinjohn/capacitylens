import env from '#start/env';

/**
 * Reports whether this installation can send email. `config/mail.ts` refuses to start with a host
 * and incomplete settings, so a host is the whole answer.
 */
export function isMailConfigured(): boolean {
  return Boolean(env.get('CAPACITYLENS_MAIL_HOST')?.trim());
}
