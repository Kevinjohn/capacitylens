import ProductException from '#exceptions/product_exception'

/** A link or token is invalid or has expired. */
export default class InvalidLinkException extends ProductException {
  static status = 400
  static code = 'E_INVALID_TOKEN'
  static message = 'This link is invalid or expired.'
}
