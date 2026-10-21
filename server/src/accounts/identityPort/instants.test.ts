import { describe, expect, it } from "vitest";
import { buildIsoInstant, parseProviderInstant, parseTimestampMilliseconds } from "./instants";

describe("timestamp instants", () => {
  it.each([
    { value: 0, expected: 0 },
    { value: 1_700_000_000, expected: 1_700_000_000_000 },
    { value: 1_700_000_000_000, expected: 1_700_000_000_000 },
    { value: 9_999_999_999, expected: 9_999_999_999_000 },
    { value: 10_000_000_000, expected: 10_000_000_000 },
    { value: "0", expected: 0 },
    { value: "1700000000", expected: 1_700_000_000_000 },
    { value: "1700000000000", expected: 1_700_000_000_000 },
    { value: "2026-07-18T00:00:00.000Z", expected: 1_784_332_800_000 },
    { value: "not-a-date", expected: null },
    { value: NaN, expected: null },
    { value: Infinity, expected: null },
    { value: -Infinity, expected: null },
    { value: 1e17, expected: null },
  ])("parses $value as $expected", ({ value, expected }) => {
    expect(parseTimestampMilliseconds(value)).toBe(expected);
  });

  it("preserves zero as an ISO epoch rather than absence", () => {
    expect(buildIsoInstant(0)).toBe("1970-01-01T00:00:00.000Z");
    expect(parseProviderInstant("0", "createdAt")).toBe("1970-01-01T00:00:00.000Z");
  });

  it("refuses an invalid ISO instant with the existing RangeError", () => {
    expect(() => buildIsoInstant("not-a-date")).toThrow(new RangeError("Invalid time value"));
  });

  it.each(["createdAt", "expiresAt"] as const)("classifies invalid provider %s permanently", (field) => {
    expect(() => parseProviderInstant("not-a-date", field)).toThrowError(
      expect.objectContaining({
        message: `The provider session has an invalid ${field} timestamp.`,
        failure: {
          code: "DEPENDENCY_INVALID_RESPONSE",
          message: `The provider session has an invalid ${field} timestamp.`,
          retryable: false,
        },
      }),
    );
  });

  it("retains finite seconds outside Date's representable range until ISO conversion", () => {
    expect(parseTimestampMilliseconds(-1e14)).toBe(-1e17);
    expect(() => buildIsoInstant(-1e14)).toThrow(new RangeError("Invalid time value"));
    expect(() => parseProviderInstant(-1e14, "createdAt")).toThrow(new RangeError("Invalid time value"));
    expect(() => parseProviderInstant(-1e14, "expiresAt")).toThrow(new RangeError("Invalid time value"));
  });
});
