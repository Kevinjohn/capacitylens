import ProductException from '#exceptions/product_exception';

/**
 * An error the product does not describe. It answers 500 with a fixed sentence and reaches the log
 * in place of the original, which it keeps as its `cause`: the logger's `err` serializer reports the
 * cause's class, frames and cause classes, never a message.
 */
export default class UnexpectedException extends ProductException {
  static status = 500;
  static message = 'Internal server error.';

  /** The log category when it is not the cause's own, such as an Account Kit server fault. */
  readonly errorType?: string;

  constructor(cause: unknown) {
    super(undefined, { cause });
  }
}
