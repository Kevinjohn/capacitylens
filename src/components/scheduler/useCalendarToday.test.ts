import { describe, expect, it } from "vitest";
import { todayISO } from "@capacitylens/shared/lib/dateMath";
import { resolveMillisecondsUntilNextCalendarDate } from "./useCalendarToday";

describe("resolveMillisecondsUntilNextCalendarDate", () => {
  it("uses the account timezone instead of the browser timezone", () => {
    const now = Date.parse("2026-06-01T09:59:59.000Z");
    expect(todayISO("Pacific/Kiritimati", now)).toBe("2026-06-01");
    expect(todayISO("Pacific/Kiritimati", now + 1_000)).toBe("2026-06-02");
    expect(resolveMillisecondsUntilNextCalendarDate("Pacific/Kiritimati", now)).toBe(1_000);
  });

  it("finds the next local date through a 25-hour DST day", () => {
    const now = Date.parse("2026-11-01T05:59:59.000Z");
    const delay = resolveMillisecondsUntilNextCalendarDate("America/New_York", now);
    expect(todayISO("America/New_York", now)).toBe("2026-11-01");
    expect(todayISO("America/New_York", now + delay - 1)).toBe("2026-11-01");
    expect(todayISO("America/New_York", now + delay)).toBe("2026-11-02");
  });
});
