import { Exception } from '@adonisjs/core/exceptions';

/**
 * An expected product refusal that carries its own HTTP status and stable code. The central handler
 * renders every subclass the same way and does not report it.
 */
export class RefusalException extends Exception {
  constructor(message: string, status: number, code: string) {
    super(message, { status, code });
  }

  /** The response body. A subclass adds only fields that are safe to send. */
  body(): Record<string, unknown> {
    return { error: this.message, code: this.code };
  }
}
