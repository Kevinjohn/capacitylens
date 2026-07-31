import { describe, expect, it } from "vitest";
import { AccountContractError, retryAfterSeconds, statusForAccountFailure, type AccountErrorCode } from "./errors";

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

describe("retry delay boundary", () => {
  it.each([0, 0.25, 12])("accepts %s seconds", (value) => {
    expect(retryAfterSeconds(value)).toBe(value);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])("rejects %s", (value) => {
    expect(() => retryAfterSeconds(value)).toThrow(RangeError);
  });

  it("revalidates branded values when constructing a contract error", () => {
    expect(
      () =>
        new AccountContractError({
          code: "RATE_LIMITED",
          message: "retry",
          retryable: true,
          retryAfterSeconds: Number.NaN as ReturnType<typeof retryAfterSeconds>,
        }),
    ).toThrow(RangeError);
  });
});
