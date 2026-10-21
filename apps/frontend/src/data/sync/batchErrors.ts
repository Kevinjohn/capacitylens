import type { DomainErrorCode } from "@capacitylens/shared/domain/errors";

/** A sync failure requiring an authoritative reload before another write may proceed. */
export abstract class BatchReconciliationError extends Error {}

/** A stale-revision batch conflict that requires authoritative reload before another write. */
export class BatchConflictError extends BatchReconciliationError {
  /** The server's copy of the conflicted row, when the 409 body carried one (best-effort parse). */
  readonly current?: unknown;
  constructor(message: string, current?: unknown) {
    super(message);
    this.name = "BatchConflictError";
    if (current !== undefined) this.current = current;
  }
}

/** A deterministic HTTP 400 rejection of a syntactically valid batch. Retrying the same local
 * tree cannot succeed; persistence must reload server truth just as it does for a stale conflict. */
export class BatchValidationError extends BatchReconciliationError {
  readonly code?: DomainErrorCode;

  constructor(message: string, code?: DomainErrorCode) {
    super(message);
    this.name = "BatchValidationError";
    if (code !== undefined) this.code = code;
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

/** A teardown save refused before dispatch because its payload exceeded the keepalive budget. */
export class KeepaliveNotDispatchedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeepaliveNotDispatchedError";
  }
}

/** Maximum serialized teardown body accepted before dispatch, leaving room below the browser quota. */
export const KEEPALIVE_BODY_BUDGET = 60 * 1024;
// Fetch keepalive quotas are shared by every in-flight request in the page. Reserve a conservative
// allowance for each request's method, URL and headers instead of spending the entire quota on
// bodies and assuming sibling lifecycle archives are free.
/** Conservative reserve for other teardown requests when estimating the page keepalive allowance. */
export const KEEPALIVE_REQUEST_OVERHEAD_BUDGET = 1024;
