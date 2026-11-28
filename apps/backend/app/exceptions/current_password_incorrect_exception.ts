import ProductException from '#exceptions/product_exception'

/** The caller's current password did not match the account. */
export default class CurrentPasswordIncorrectException extends ProductException {
  static status = 403
  static code = 'E_CURRENT_PASSWORD_INCORRECT'
  static message = 'Current password is incorrect.'
}
