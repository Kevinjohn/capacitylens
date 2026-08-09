import { describe, expect, it } from "vitest";
import { DOMAIN_ERROR_CODES, DomainError, domainError, isDomainErrorCode } from "./errors";

describe("isDomainErrorCode", () => {
  it("accepts every declared domain error code", () => {
    for (const code of DOMAIN_ERROR_CODES) {
      expect(isDomainErrorCode(code)).toBe(true);
    }
  });

  it("rejects a string that isn't a declared code", () => {
    expect(isDomainErrorCode("not_a_real_code")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isDomainErrorCode(undefined)).toBe(false);
    expect(isDomainErrorCode(null)).toBe(false);
    expect(isDomainErrorCode(42)).toBe(false);
  });
});

describe("domainError", () => {
  it("throws a DomainError carrying the code and message", () => {
    expect(() => domainError("date_invalid", "That date is invalid.")).toThrow(DomainError);
    try {
      domainError("date_invalid", "That date is invalid.");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).name).toBe("DomainError");
      expect((err as DomainError).code).toBe("date_invalid");
      expect((err as DomainError).message).toBe("That date is invalid.");
    }
  });
});
