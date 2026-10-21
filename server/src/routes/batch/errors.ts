import { REPLY_ERRORS } from "../replyErrors";

/** Signals a stale batch write and carries the stored row for the canonical 409 response.
 * It escapes the enclosing transaction so every operation is rolled back before the handler responds.
 * A conflict must not be reclassified as malformed input.
 */
export class StaleWriteError extends Error {
  constructor(readonly current: Record<string, unknown>) {
    super(REPLY_ERRORS.staleWrite);
    this.name = "StaleWriteError";
  }
}

/** Internal control signal: a post-lock batch authorization recheck already sent its refusal. */
export class BatchAuthorizationResponseSent extends Error {}
