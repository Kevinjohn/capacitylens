import { describe, it, expect } from "vitest";
import { formatShortDate, formatDayCount, formatDayMonth, formatInstant, formatInstantDate } from "./dateDisplay";
import type { ISODate } from "@capacitylens/shared/types/entities";

const invalidDate = "not-a-date" as ISODate;

describe("formatShortDate", () => {
  it("renders abbreviated weekday + ordinal day + abbreviated month, with no year", () => {
    // 2026-07-01 is a Wednesday; 2026-06-10 a Wednesday.
    expect(formatShortDate("2026-07-01")).toBe("Wed 1st Jul");
    expect(formatShortDate("2026-06-10")).toBe("Wed 10th Jun");
  });

  it("uses the correct English ordinal suffixes", () => {
    expect(formatShortDate("2026-07-02")).toBe("Thu 2nd Jul");
    expect(formatShortDate("2026-07-03")).toBe("Fri 3rd Jul");
    expect(formatShortDate("2026-07-11")).toBe("Sat 11th Jul"); // not "11st"
    expect(formatShortDate("2026-07-21")).toBe("Tue 21st Jul");
    expect(formatShortDate("2026-07-22")).toBe("Wed 22nd Jul");
  });

  it("resolves date presentation through the active i18n locale seam", () => {
    expect(formatShortDate("2026-06-10")).toBe("Wed 10th Jun");
  });

  it("surfaces an invalid upstream date instead of hiding it", () => {
    expect(() => formatShortDate(invalidDate)).toThrow(RangeError);
  });
});

describe("formatDayMonth", () => {
  it("renders day + abbreviated month, with no weekday, ordinal or year", () => {
    expect(formatDayMonth("2026-07-01")).toBe("1 Jul");
    expect(formatDayMonth("2026-06-10")).toBe("10 Jun");
  });

  it("stays terser than the list form it sits beside", () => {
    expect(formatDayMonth("2026-06-10").length).toBeLessThan(formatShortDate("2026-06-10").length);
  });

  it("surfaces an invalid upstream date instead of hiding it", () => {
    expect(() => formatDayMonth(invalidDate)).toThrow(RangeError);
  });
});

describe("formatDayCount", () => {
  it("counts inclusively and pluralises", () => {
    expect(formatDayCount("2026-07-01", "2026-07-05")).toBe("5 days");
    expect(formatDayCount("2026-06-12", "2026-06-22")).toBe("11 days");
  });

  it("uses the singular for a one-day range", () => {
    expect(formatDayCount("2026-07-01", "2026-07-01")).toBe("1 day");
  });

  it('clamps a reversed range to "0 days" rather than going negative', () => {
    expect(formatDayCount("2026-07-05", "2026-07-01")).toBe("0 days");
  });

  it("surfaces an invalid upstream range instead of rendering a NaN label", () => {
    expect(() => formatDayCount(invalidDate, "2026-07-01")).toThrow(RangeError);
    expect(() => formatDayCount("2026-07-01", invalidDate)).toThrow(RangeError);
  });
});

// The instant formatters render on the viewer's own clock. Assertions stay locale-agnostic on
// purpose: these deliberately take NO locale argument (see the module's "Instants" note), so pinning
// literal en-GB or en-US output would pin the CI runner's ICU default rather than the contract.
describe("formatInstant / formatInstantDate", () => {
  // The vitest environment fixes TZ=UTC, so 13:45Z is 13:45 local here.
  const instant = "2026-07-14T13:45:00.000Z";

  it("renders exactly what the call sites they replace rendered", () => {
    // Behaviour preservation IS the contract this round: the browser-default locale, not
    // activeDateLocale()'s enGB. This assertion fails the moment a locale argument is introduced.
    expect(formatInstant(instant)).toBe(new Date(instant).toLocaleString());
    expect(formatInstantDate(instant)).toBe(new Date(instant).toLocaleDateString());
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
    // Late-evening UTC: the day component must come from the Date, not from characters 0-9 of the
    // ISO string (which is what these replaced, and what misreads by a day outside UTC).
    const lateEvening = "2026-07-14T23:30:00.000Z";
    const local = new Date(lateEvening);
    expect(formatInstantDate(lateEvening)).toBe(local.toLocaleDateString());
    expect(formatInstantDate(lateEvening)).toContain(String(local.getDate()));
  });

  it("degrades an unparseable timestamp to Invalid Date instead of throwing", () => {
    // Unlike the ISODate formatters above, these render SERVER-supplied values: a bad one must cost
    // one row, not the whole section.
    expect(() => formatInstant("not-a-timestamp")).not.toThrow();
    expect(formatInstant("not-a-timestamp")).toBe("Invalid Date");
    expect(formatInstantDate("not-a-timestamp")).toBe("Invalid Date");
  });
});
