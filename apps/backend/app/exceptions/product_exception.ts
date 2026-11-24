import { Exception } from '@adonisjs/core/exceptions';
import type { HttpContext } from '@adonisjs/core/http';

/**
 * A product exception carries its own status, code and a message that is safe to send and to log.
 * It answers for itself with the product's flat error body: the framework's exception handler calls
 * `handle` on a thrown exception that has one, so no central table lists product exceptions.
 */
export class ProductException extends Exception {
  /** The response body: the message, the code when there is one, and any field a subclass adds. */
  body(): Record<string, unknown> {
    return { error: this.message, ...(this.code ? { code: this.code } : {}) };
  }

  async handle(error: this, ctx: HttpContext) {
    ctx.response.status(error.status).send(error.body());
  }
}
