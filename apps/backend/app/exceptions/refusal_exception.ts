import ProductException from '#exceptions/product_exception';

/** An expected product refusal. Each cause is a subclass that states its status and code. */
export default class RefusalException extends ProductException {
  constructor(message?: string) {
    super(message);
  }
}
