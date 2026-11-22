import capacitylens from '#config/capacitylens';

/**
 * Reports whether this installation can send email. `config/mail.ts` refuses to start with a host
 * and incomplete settings, so a host is the whole answer.
 */
export function isMailConfigured(): boolean {
  return Boolean(capacitylens.mailHost?.trim());
}
