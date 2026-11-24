import { ProductException } from '#exceptions/product_exception';

/** An expected product refusal that carries its own HTTP status and stable code. */
export class RefusalException extends ProductException {
  constructor(message: string, status: number, code: string) {
    super(message, { status, code });
  }
}
