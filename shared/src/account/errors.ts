import type { CommandId } from "./types";

export type AccountErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "MFA_REQUIRED"
  | "SESSION_NOT_FRESH"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "NOT_MEMBER"
  | "VALIDATION_FAILED"
  | "CONFLICT"
  | "COMMAND_IN_PROGRESS"
  | "OWNER_TRANSFER_REQUIRED"
  | "INVITATION_EXPIRED"
  | "INVITATION_USED"
  | "INVITATION_EMAIL_MISMATCH"
  | "IDENTITY_ALREADY_EXISTS"
  | "AUTHORITY_CHANGED"
  | "IDEMPOTENCY_CONFLICT"
  | "COMPENSATION_FAILED"
  | "DEPENDENCY_UNAVAILABLE"
  | "DEPENDENCY_INVALID_RESPONSE"
  | "RATE_LIMITED"
  | "UNSUPPORTED_CAPABILITY";

interface AccountFailureBase {
  code: AccountErrorCode;
  message: string;
  commandId?: CommandId;
}

declare const retryAfterSecondsBrand: unique symbol;

/** A finite, non-negative retry delay. Fractional seconds are retained for sub-second callers;
 * transport adapters may round them up when emitting whole-second Retry-After headers. */
export type RetryAfterSeconds = number & { readonly [retryAfterSecondsBrand]: true };

export function retryAfterSeconds(value: number): RetryAfterSeconds {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("retryAfterSeconds must be a finite, non-negative number.");
  }
  return value as RetryAfterSeconds;
}

/** A normalized boundary failure. A retry delay is meaningful only when retrying is permitted;
 * the union makes the contradictory `retryable: false` plus delay shape unrepresentable. Codes do
 * not imply retryability by themselves: dependency and reconciliation failures can be terminal or
 * transient according to how far their underlying operation progressed. */
export type AccountFailure =
  | (AccountFailureBase & { retryable: false; retryAfterSeconds?: never })
  | (AccountFailureBase & { retryable: true; retryAfterSeconds?: RetryAfterSeconds });

/** Normalized boundary error. Vendor/SQL errors remain internal causes, never public shapes. */
export class AccountContractError extends Error {
  readonly failure: AccountFailure;

  constructor(failure: AccountFailure, options: ErrorOptions = {}) {
    super(failure.message, options);
    this.name = "AccountContractError";
    this.failure =
      failure.retryable && failure.retryAfterSeconds !== undefined
        ? { ...failure, retryAfterSeconds: retryAfterSeconds(failure.retryAfterSeconds) }
        : failure;
  }
}

const ACCOUNT_FAILURE_STATUS = {
  AUTHENTICATION_REQUIRED: 401,
  MFA_REQUIRED: 403,
  SESSION_NOT_FRESH: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  NOT_MEMBER: 403,
  VALIDATION_FAILED: 400,
  CONFLICT: 409,
  COMMAND_IN_PROGRESS: 409,
  OWNER_TRANSFER_REQUIRED: 400,
  INVITATION_EXPIRED: 410,
  INVITATION_USED: 409,
  INVITATION_EMAIL_MISMATCH: 403,
  IDENTITY_ALREADY_EXISTS: 400,
  AUTHORITY_CHANGED: 409,
  IDEMPOTENCY_CONFLICT: 409,
  COMPENSATION_FAILED: 503,
  DEPENDENCY_UNAVAILABLE: 503,
  DEPENDENCY_INVALID_RESPONSE: 503,
  RATE_LIMITED: 429,
  UNSUPPORTED_CAPABILITY: 400,
} as const satisfies Record<AccountErrorCode, number>;

export function statusForAccountFailure(failure: AccountFailure): number {
  return ACCOUNT_FAILURE_STATUS[failure.code];
}
