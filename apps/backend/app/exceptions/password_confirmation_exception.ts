import { RefusalException } from '#exceptions/refusal_exception';

export class PasswordConfirmationException extends RefusalException {
  constructor(message = 'Confirm this action again.') {
    super(message, 403, 'PASSWORD_CONFIRMATION_REQUIRED');
  }
}
