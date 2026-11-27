import RefusalException from '#exceptions/refusal_exception'

export default class PasswordConfirmationException extends RefusalException {
  static status = 403
  static code = 'E_PASSWORD_CONFIRMATION_REQUIRED'
  static message = 'Confirm this action again.'
}
