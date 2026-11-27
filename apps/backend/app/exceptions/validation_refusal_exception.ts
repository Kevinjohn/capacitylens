import ProductException from '#exceptions/product_exception'

/** The framework's validation body, `{ errors: [{ message }] }`, for one refusal sentence. */
export function buildValidationBody(message: string) {
  return { errors: [{ message }] }
}

/**
 * Input the product refuses after request validation passed, such as a domain rule. It answers
 * like a request validation failure, 422 with the framework's `{ errors }` body, so the browser
 * reads one shape for invalid input.
 */
export default class ValidationRefusalException extends ProductException {
  static status = 422

  constructor(message: string) {
    super(message)
  }

  override body() {
    return buildValidationBody(this.message)
  }
}
