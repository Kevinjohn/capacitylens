import { type DomainErrorCode } from "@capacitylens/shared/domain/errors";

/**
 * Thrown when POST /api/batch answers **409** — the server's optimistic-concurrency conflict
 * signal (a stale `updatedAt`; ordered browser batches enforce this even when generic optimistic
 * concurrency is explicitly disabled; body `{ error, current }`, see the server's StaleWriteError
 * arm). A TYPED error, not the generic batch failure, because the
 * persist layer must treat it differently: retrying the same stale diff is deterministic futility
 * (the server will 409 it forever), so persist.ts resolves a conflict by RELOADING the active
 * slice (server wins — the documented interim policy until a conflict UI exists).
 */
export abstract class BatchReconciliationError extends Error {}

export class BatchConflictError extends BatchReconciliationError {
  /** The server's copy of the conflicted row, when the 409 body carried one (best-effort parse). */
  readonly current?: unknown;
  constructor(message: string, current?: unknown) {
    super(message);
    this.name = "BatchConflictError";
    this.current = current;
  }
}

/** A deterministic HTTP 400 rejection of a syntactically valid batch. Retrying the same local
 * tree cannot succeed; persistence must reload server truth just as it does for a stale conflict. */
export class BatchValidationError extends BatchReconciliationError {
  readonly code?: DomainErrorCode;

  constructor(message: string, code?: DomainErrorCode) {
    super(message);
    this.name = "BatchValidationError";
    this.code = code;
  }
}

/** A stale or in-flight client mutation reached the server after masquerade made the session
 * read-only. Retrying cannot succeed until an authoritative projection reload completes. */
export class BatchMasqueradeReadOnlyError extends BatchReconciliationError {
  constructor(message: string) {
    super(message);
    this.name = "BatchMasqueradeReadOnlyError";
  }
}

/** A 2xx response that does not prove which rows committed. The server may already have written
 * the batch, so retrying against the prior snapshot is unsafe; persistence must reload first. */
export class BatchCommitUncertainError extends BatchReconciliationError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BatchCommitUncertainError";
  }
}

/** A remembered sync archive could not be reversed authoritatively. Reload instead of replaying a
 * generic PUT that the server's lifecycle boundary cannot use to clear a tombstone. */
export class LifecycleRestoreError extends BatchReconciliationError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LifecycleRestoreError";
  }
}

/**
 * Thrown when a single logical diff exceeds {@link MAX_OPS_PER_BATCH}. The atomic design refuses to
 * split it into separately-committed prefixes (that would reintroduce the reparent-before-delete
 * FK-order race the single transaction exists to prevent), so this is a TERMINAL, non-retryable
 * condition — re-sending the identical over-limit diff throws forever, unlike a transient network
 * failure. A TYPED error (not the generic batch failure) so persist.ts can special-case it: surface
 * the banner plus a clear sticky notice and STOP the exponential-backoff retry loop. The desired
 * state stays in memory until a later, smaller diff lands or the page is closed.
 */
export class BatchTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BatchTooLargeError";
  }
}

export class KeepaliveNotDispatchedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeepaliveNotDispatchedError";
  }
}

// One logical diff is always one server transaction. The client never slices this limit into
// separately committed prefixes; an over-limit diff fails atomically. Server-mode imports use
// their dedicated atomic endpoint.
export const MAX_OPS_PER_BATCH = 5000;
export const KEEPALIVE_BODY_BUDGET = 60 * 1024;
// Fetch keepalive quotas are shared by every in-flight request in the page. Reserve a conservative
// allowance for each request's method, URL and headers instead of spending the entire quota on
// bodies and assuming sibling lifecycle archives are free.
export const KEEPALIVE_REQUEST_OVERHEAD_BUDGET = 1024;
