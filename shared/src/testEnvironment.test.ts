import { describe, expect, it } from "vitest";

describe("test environment", () => {
  it("pins the local timezone to UTC", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("UTC");
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(0);
  });
});
