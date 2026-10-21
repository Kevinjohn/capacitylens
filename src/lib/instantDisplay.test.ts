import { describe, expect, it } from "vitest";
import { formatInstant, formatInstantDate } from "./instantDisplay";

// The instant formatters render on the viewer's own clock. Assertions stay locale-agnostic on
// purpose: these deliberately take no locale argument (see the module's "Instants" note), so pinning
// literal en-GB or en-US output would pin the CI runner's ICU default rather than the contract.
describe("formatInstant / formatInstantDate", () => {
  // The vitest environment fixes TZ=UTC, so 13:45Z is 13:45 local here.
  const instant = "2026-07-14T13:45:00.000Z";

  it("uses the browser's default locale", () => {
    expect(formatInstant(instant)).toBe(new Date(instant).toLocaleString());
    expect(formatInstantDate(instant)).toBe(new Date(instant).toLocaleDateString());
  });

  it("renders a numeric epoch exactly like the equivalent timestamp string", () => {
    expect(formatInstant(Date.parse(instant))).toBe(formatInstant(instant));
  });

  it("keeps the hour, which the 24h reset link and session rows depend on", () => {
    expect(formatInstant(instant)).toContain(":");
    expect(formatInstant(instant)).toContain("45");
  });

  it("drops the time for the date-only form", () => {
    expect(formatInstantDate(instant)).not.toContain(":");
    expect(formatInstantDate(instant)).not.toContain("45");
  });

  it("agrees with the date-and-time form on the date itself", () => {
    expect(formatInstant(instant)).toContain(formatInstantDate(instant));
  });

  it("resolves the local calendar day rather than slicing the UTC string", () => {
    const lateEvening = "2026-07-14T23:30:00.000Z";
    const local = new Date(lateEvening);
    expect(formatInstantDate(lateEvening)).toBe(local.toLocaleDateString());
    expect(formatInstantDate(lateEvening)).toContain(String(local.getDate()));
  });

  it("degrades an unparseable timestamp to Invalid Date instead of throwing", () => {
    expect(() => formatInstant("not-a-timestamp")).not.toThrow();
    expect(formatInstant("not-a-timestamp")).toBe("Invalid Date");
    expect(formatInstantDate("not-a-timestamp")).toBe("Invalid Date");
  });
});
