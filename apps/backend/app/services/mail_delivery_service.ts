import capacitylens from '#config/capacitylens';

/** Whether this installation can send email. */
export class MailDeliveryService {
  /**
   * Reports whether this installation can send email. `config/mail.ts` refuses to start with a host
   * and incomplete settings, so a host is the whole answer.
   */
  isMailConfigured(): boolean {
    return Boolean(capacitylens.mailHost?.trim());
  }
}
