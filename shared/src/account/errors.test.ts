import { describe, expect, it } from "vitest";
import { statusForAccountFailure, type AccountErrorCode } from "./errors";

describe("account failure status mapping", () => {
  const expected = {
    AUTHENTICATION_REQUIRED: 401,
    FORBIDDEN: 403,
    INVITATION_EXPIRED: 410,
    INVITATION_USED: 409,
    COMMAND_IN_PROGRESS: 409,
    RATE_LIMITED: 429,
    DEPENDENCY_UNAVAILABLE: 503,
    VALIDATION_FAILED: 400,
    MFA_REQUIRED: 403,
    SESSION_NOT_FRESH: 403,
    NOT_FOUND: 404,
    NOT_MEMBER: 403,
    CONFLICT: 409,
    OWNER_TRANSFER_REQUIRED: 400,
    INVITATION_EMAIL_MISMATCH: 403,
    IDENTITY_ALREADY_EXISTS: 400,
    AUTHORITY_CHANGED: 409,
    IDEMPOTENCY_CONFLICT: 409,
    COMPENSATION_FAILED: 503,
    DEPENDENCY_INVALID_RESPONSE: 503,
    UNSUPPORTED_CAPABILITY: 400,
  } satisfies Record<AccountErrorCode, number>;
  it.each(Object.entries(expected) as Array<[AccountErrorCode, number]>)("%s maps to %s", (code, status) => {
    expect(statusForAccountFailure({ code, message: code, retryable: false })).toBe(status);
  });
});
