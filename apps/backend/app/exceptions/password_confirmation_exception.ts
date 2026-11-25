import { RefusalException } from '#exceptions/refusal_exception';

export class PasswordConfirmationException extends RefusalException {
  static status = 403;
  static code = 'PASSWORD_CONFIRMATION_REQUIRED';
  static message = 'Confirm this action again.';
}
