import ProductException from '#exceptions/product_exception'

/** A confirmation email could not be delivered after the address was committed. */
export default class VerificationDeliveryFailedException extends ProductException {
  static status = 503
  static code = 'E_MAIL_UNAVAILABLE'
  static message = 'The confirmation email could not be sent. Try again later.'
}
