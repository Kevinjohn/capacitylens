import ProductException from '#exceptions/product_exception'

/** Password sign-in failed with invalid credentials. */
export default class InvalidCredentialsException extends ProductException {
  static status = 401
  static message = 'Invalid email or password.'
}
