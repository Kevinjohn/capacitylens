import { ProductException } from '#exceptions/product_exception';

/** A refused entity write with a safe message, its stated status and code, and the current revision. */
export class EntityWriteException extends ProductException {
  constructor(
    message: string,
    status = 400,
    readonly current?: Record<string, unknown>,
    code?: string
  ) {
    super(message, { status, code });
  }

  override body() {
    return { ...super.body(), ...(this.current ?? {}) };
  }
}
