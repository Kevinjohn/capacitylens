import ProductException from '#exceptions/product_exception'

/** A refused entity write with a safe message. A subclass states another status or a code. */
export default class EntityWriteException extends ProductException {
  static status = 400
  static code = 'E_ENTITY_WRITE'
  static message = 'Entity write refused.'

  constructor(message?: string, options?: ErrorOptions) {
    super(message, options)
  }
}
