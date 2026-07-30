import { describe, it, expect } from "vitest";
import { addDaysISO } from "@capacitylens/shared/lib/dateMath";

describe("shared-domain smoke", () => {
  it("resolves and executes the shared date core through the application alias", () => {
    expect(addDaysISO("2026-07-29", 1)).toBe("2026-07-30");
  });
});
