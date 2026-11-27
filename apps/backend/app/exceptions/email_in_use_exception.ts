import ProductException from '#exceptions/product_exception'

/** An account already uses the supplied email address. */
export default class EmailInUseException extends ProductException {
  static status = 409
  static code = 'E_EMAIL_IN_USE'
  static message = 'An account already uses this email. Sign in or reset your password.'
}
