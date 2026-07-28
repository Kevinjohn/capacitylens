import { describe, expect, it } from "vitest";
import { isIsoInstant } from "./types";

describe("IsoInstant", () => {
  it("accepts only the canonical UTC millisecond representation", () => {
    expect(isIsoInstant("2026-07-18T10:00:00.000Z")).toBe(true);
    expect(isIsoInstant("2026-07-18T10:00:00Z")).toBe(false);
    expect(isIsoInstant("2026-07-18T11:00:00.000+01:00")).toBe(false);
    expect(isIsoInstant("2026-02-30T10:00:00.000Z")).toBe(false);
    expect(isIsoInstant("yesterday")).toBe(false);
    expect(isIsoInstant(null)).toBe(false);
  });
});
