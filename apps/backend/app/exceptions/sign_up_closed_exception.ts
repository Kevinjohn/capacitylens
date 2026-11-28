import ProductException from '#exceptions/product_exception'

/** Open sign-up is disabled or blocked until the first company exists. */
export default class SignUpClosedException extends ProductException {
  static status = 403
  static code = 'E_SIGN_UP_CLOSED'
  static message = 'Sign-up is closed.'
}
