import { describe, it, expect } from "vitest";
import { formatShortDate, formatDayCount } from "./dateDisplay";
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
