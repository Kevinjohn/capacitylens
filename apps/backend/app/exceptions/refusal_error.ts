/**
 * An expected product refusal that carries its own HTTP status and stable code. The central handler
 * renders every subclass the same way and does not report it.
 */
export class RefusalError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
  }

  /** The response body. A subclass adds only fields that are safe to send. */
  body(): Record<string, unknown> {
    return { error: this.message, code: this.code };
  }
}
