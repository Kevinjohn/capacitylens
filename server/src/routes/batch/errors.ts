/** Batch-internal stale-write signal (optimistic concurrency, fix parity with the direct PUT
 * route). Carries the STORED row so the batch handler can send the direct route's exact 409
 * shape (`{ error, current }`). It is thrown from INSIDE tx(), so by construction the whole
 * batch has already rolled back by the time the handler catches it — all-or-nothing, no op from
 * the conflicted batch persists. NOT a ValidationError: this is a conflict (409), not a
 * malformed request (400), and it must never be re-classified by statusFor. */
export class StaleWriteError extends Error {
  constructor(readonly current: Record<string, unknown>) {
    super("The record was modified more recently on the server.");
    this.name = "StaleWriteError";
  }
}

/** Internal control signal: a post-lock batch authorization recheck already sent its refusal. */
export class BatchAuthorizationResponseSent extends Error {}
