import { enGB, fr } from "date-fns/locale";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatDayCount,
  formatDayMonth,
  formatDayMonthRange,
  formatInstant,
  formatInstantDate,
  formatMonthYear,
  formatScheduleDate,
  formatScheduleDateRange,
  formatShortDate,
  formatShortDateRange,
  formatWeekdayScheduleDate,
} from "./dateDisplay";
import { writeStoredDateStyle, type DateStyle } from "./dateStyle";
import type { ISODate } from "@capacitylens/shared/types/entities";

const dateLocaleMocks = vi.hoisted(() => ({ readActiveDateLocale: vi.fn() }));
vi.mock("@/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/i18n")>()),
  readActiveDateLocale: dateLocaleMocks.readActiveDateLocale,
}));

beforeEach(() => {
  dateLocaleMocks.readActiveDateLocale.mockReturnValue(enGB);
  localStorage.clear();
});
afterEach(() => {
  localStorage.clear();
});

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

  it("always carries the ordinal, even under a non-ordinal style", () => {
    writeStoredDateStyle("month-day");
    expect(formatShortDate("2026-06-10")).toBe("Wed Jun 10th");
  });

  it("surfaces an invalid upstream date instead of hiding it", () => {
    expect(() => formatShortDate(invalidDate)).toThrow(RangeError);
  });
});

describe("formatShortDateRange", () => {
  it("degrades a same-day range to formatShortDate", () => {
    expect(formatShortDateRange("2026-06-10", "2026-06-10")).toBe(formatShortDate("2026-06-10"));
  });

  it("collapses a same-month range under day-month order", () => {
    // 2026-06-05 is a Friday; 2026-06-08 a Monday.
    expect(formatShortDateRange("2026-06-05", "2026-06-08")).toBe("Fri 5th – Mon 8th Jun");
  });

  it("shows the month at both ends for a cross-month range under day-month order", () => {
    expect(formatShortDateRange("2026-06-05", "2026-07-08")).toBe("Fri 5th Jun – Wed 8th Jul");
  });

  it("collapses a same-month range under month-day order", () => {
    writeStoredDateStyle("month-day");
    expect(formatShortDateRange("2026-06-05", "2026-06-08")).toBe("Fri Jun 5th – Mon 8th");
  });

  it("shows the month at both ends for a cross-month range under month-day order", () => {
    writeStoredDateStyle("month-day");
    expect(formatShortDateRange("2026-06-05", "2026-07-08")).toBe("Fri Jun 5th – Wed Jul 8th");
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

describe("formatDayMonthRange", () => {
  it("degrades a same-day range to formatDayMonth", () => {
    expect(formatDayMonthRange("2026-09-09", "2026-09-09")).toBe(formatDayMonth("2026-09-09"));
  });

  it("collapses a same-month range under day-month order", () => {
    expect(formatDayMonthRange("2026-09-09", "2026-09-14")).toBe("9 – 14 Sep");
  });

  it("shows both months for a cross-month range under day-month order", () => {
    expect(formatDayMonthRange("2026-09-09", "2026-10-14")).toBe("9 Sep – 14 Oct");
  });
});

describe("formatMonthYear", () => {
  it("renders month + year, unaffected by the active style", () => {
    writeStoredDateStyle("month-day-ordinal");
    expect(formatMonthYear("2026-09-09")).toBe("Sep 2026");
  });
});

describe("formatWeekdayScheduleDate", () => {
  it("renders weekday + full date, with no ordinal, under day-month order", () => {
    expect(formatWeekdayScheduleDate("2026-09-09")).toBe("Wed 9 Sep 2026");
  });

  it("renders weekday + full date, with no ordinal, under month-day order", () => {
    writeStoredDateStyle("month-day");
    expect(formatWeekdayScheduleDate("2026-09-09")).toBe("Wed Sep 9, 2026");
  });

  it("does not gain an ordinal under an ordinal style", () => {
    writeStoredDateStyle("day-ordinal-month");
    expect(formatWeekdayScheduleDate("2026-09-09")).toBe("Wed 9 Sep 2026");
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

describe("schedule dates", () => {
  it("shows the year once for a same-year range", () => {
    expect(formatScheduleDateRange("2026-09-07", "2026-10-04")).toBe("7 Sep – 4 Oct 2026");
  });

  it("shows both years for a cross-year range", () => {
    expect(formatScheduleDateRange("2026-12-28", "2027-01-08")).toBe("28 Dec 2026 – 8 Jan 2027");
  });

  it("shows one full date for a single-day range", () => {
    expect(formatScheduleDateRange("2026-09-10", "2026-09-10")).toBe("10 Sep 2026");
  });

  it("always includes the year for a standalone schedule date", () => {
    expect(formatScheduleDate("2027-01-15")).toBe("15 Jan 2027");
  });

  it("resolves schedule dates through the active locale on every call", () => {
    expect(formatScheduleDate("2026-09-10")).toBe("10 Sep 2026");

    dateLocaleMocks.readActiveDateLocale.mockReturnValue(fr);

    expect(formatScheduleDate("2026-09-10")).toBe("10 sept. 2026");
    expect(formatScheduleDateRange("2026-09-07", "2026-10-04")).toBe("7 sept. – 4 oct. 2026");
  });

  it("surfaces invalid upstream schedule dates", () => {
    expect(() => formatScheduleDate(invalidDate)).toThrow(RangeError);
    expect(() => formatScheduleDateRange(invalidDate, "2026-09-10")).toThrow(RangeError);
  });
});

// Every cell of the plan's style table (issue #793), exercised through the range and single-date
// helpers it governs. `writeStoredDateStyle` sets the style for each style-table describe block;
// `localStorage.clear()` in `afterEach` above resets it back to the default between blocks.
const STYLE_TABLE: Record<
  DateStyle,
  {
    single: string;
    sameMonth: string;
    crossMonth: string;
    singleWithYear: string;
    sameMonthWithYear: string;
    crossMonthSameYearWithYear: string;
    crossYear: string;
  }
> = {
  "day-month": {
    single: "9 Sep",
    sameMonth: "9 – 14 Sep",
    crossMonth: "9 Sep – 14 Oct",
    singleWithYear: "9 Sep 2026",
    sameMonthWithYear: "9 – 14 Sep 2026",
    crossMonthSameYearWithYear: "9 Sep – 14 Oct 2026",
    crossYear: "28 Dec 2026 – 8 Jan 2027",
  },
  "day-ordinal-month": {
    single: "9th Sep",
    sameMonth: "9th – 14th Sep",
    crossMonth: "9th Sep – 14th Oct",
    singleWithYear: "9th Sep 2026",
    sameMonthWithYear: "9th – 14th Sep 2026",
    crossMonthSameYearWithYear: "9th Sep – 14th Oct 2026",
    crossYear: "28th Dec 2026 – 8th Jan 2027",
  },
  "month-day": {
    single: "Sep 9",
    sameMonth: "Sep 9 – 14",
    crossMonth: "Sep 9 – Oct 14",
    singleWithYear: "Sep 9, 2026",
    sameMonthWithYear: "Sep 9 – 14, 2026",
    crossMonthSameYearWithYear: "Sep 9 – Oct 14, 2026",
    crossYear: "Dec 28, 2026 – Jan 8, 2027",
  },
  "month-day-ordinal": {
    single: "Sep 9th",
    sameMonth: "Sep 9th – 14th",
    crossMonth: "Sep 9th – Oct 14th",
    singleWithYear: "Sep 9th, 2026",
    sameMonthWithYear: "Sep 9th – 14th, 2026",
    crossMonthSameYearWithYear: "Sep 9th – Oct 14th, 2026",
    crossYear: "Dec 28th, 2026 – Jan 8th, 2027",
  },
};

describe.each(Object.entries(STYLE_TABLE))("date style %s", (style, cells) => {
  beforeEach(() => writeStoredDateStyle(style as DateStyle));

  it("formats a single date with no year (formatDayMonth)", () => {
    expect(formatDayMonth("2026-09-09")).toBe(cells.single);
  });

  it("formats a same-month range with no year (formatDayMonthRange)", () => {
    expect(formatDayMonthRange("2026-09-09", "2026-09-14")).toBe(cells.sameMonth);
  });

  it("formats a cross-month range with no year (formatDayMonthRange)", () => {
    expect(formatDayMonthRange("2026-09-09", "2026-10-14")).toBe(cells.crossMonth);
  });

  it("formats a single date with year (formatScheduleDate)", () => {
    expect(formatScheduleDate("2026-09-09")).toBe(cells.singleWithYear);
  });

  it("formats a same-month range with year (formatScheduleDateRange)", () => {
    expect(formatScheduleDateRange("2026-09-09", "2026-09-14")).toBe(cells.sameMonthWithYear);
  });

  it("formats a same-year cross-month range with year (formatScheduleDateRange)", () => {
    expect(formatScheduleDateRange("2026-09-09", "2026-10-14")).toBe(cells.crossMonthSameYearWithYear);
  });

  it("formats a cross-year range (formatScheduleDateRange)", () => {
    expect(formatScheduleDateRange("2026-12-28", "2027-01-08")).toBe(cells.crossYear);
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
