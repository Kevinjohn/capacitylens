import { describe, it, expect } from "vitest";
import type { Weekday } from "../types/entities";
import {
  addDaysISO,
  countWorkingDays,
  dayIndex,
  daysInclusive,
  eachDayISO,
  endDateForWorkingDays,
  isWithin,
  isWeekendAware,
  MAX_MATERIALISED_DAYS,
  parseDate,
  rangesOverlap,
  startOfWeekISO,
  toISODate,
  weekdayOf,
} from "./dateMath";

describe("dateMath", () => {
  it("dayIndex counts whole calendar days from the origin", () => {
    expect(dayIndex("2026-05-29", "2026-05-29")).toBe(0);
    expect(dayIndex("2026-05-30", "2026-05-29")).toBe(1);
    expect(dayIndex("2026-05-28", "2026-05-29")).toBe(-1);
    expect(dayIndex("2026-06-05", "2026-05-29")).toBe(7);
  });

  it("addDaysISO adds and subtracts across month/year boundaries", () => {
    expect(addDaysISO("2026-05-29", 1)).toBe("2026-05-30");
    expect(addDaysISO("2026-05-29", -1)).toBe("2026-05-28");
    expect(addDaysISO("2026-05-31", 1)).toBe("2026-06-01");
    expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("daysInclusive treats both ends inclusively", () => {
    expect(daysInclusive("2026-05-29", "2026-05-29")).toBe(1);
    expect(daysInclusive("2026-05-29", "2026-05-30")).toBe(2);
    expect(daysInclusive("2026-05-29", "2026-06-04")).toBe(7);
  });

  it("is immune to spring-forward DST (no off-by-one across the boundary)", () => {
    // US DST 2026 spring-forward is 2026-03-08.
    expect(dayIndex("2026-03-09", "2026-03-07")).toBe(2);
    expect(daysInclusive("2026-03-07", "2026-03-09")).toBe(3);
    expect(addDaysISO("2026-03-07", 2)).toBe("2026-03-09");
    expect(eachDayISO("2026-03-07", "2026-03-09")).toEqual(["2026-03-07", "2026-03-08", "2026-03-09"]);
  });

  it("eachDayISO lists inclusive dates, empty when reversed", () => {
    expect(eachDayISO("2026-05-29", "2026-05-31")).toEqual(["2026-05-29", "2026-05-30", "2026-05-31"]);
    expect(eachDayISO("2026-05-31", "2026-05-29")).toEqual([]);
  });

  it("eachDayISO returns a single-element array for a same-day range", () => {
    expect(eachDayISO("2026-06-15", "2026-06-15")).toEqual(["2026-06-15"]);
  });

  it("eachDayISO rejects ranges too large to materialise safely", () => {
    expect(() => eachDayISO("1900-01-01", "2100-01-01")).toThrow(
      `Date range exceeds the ${MAX_MATERIALISED_DAYS}-day materialisation limit.`,
    );
  });

  it("eachDayISO is empty for ANY end-before-start range, not just adjacent reversals", () => {
    expect(eachDayISO("2026-06-15", "2026-01-01")).toEqual([]);
  });

  it("eachDayISO steps correctly across a month boundary", () => {
    expect(eachDayISO("2026-01-30", "2026-02-02")).toEqual(["2026-01-30", "2026-01-31", "2026-02-01", "2026-02-02"]);
    expect(eachDayISO("2024-02-27", "2024-03-01")).toEqual(["2024-02-27", "2024-02-28", "2024-02-29", "2024-03-01"]);
  });
});

describe("dateMath range predicates", () => {
  it("preserves rangesOverlap's public four-argument runtime arity", () => {
    expect(rangesOverlap.length).toBe(4);
  });

  it("weekdayOf returns 0=Sun … 6=Sat", () => {
    expect(weekdayOf("2026-05-31")).toBe(0);
    expect(weekdayOf("2026-06-01")).toBe(1);
    expect(weekdayOf("2026-05-29")).toBe(5);
  });

  it("startOfWeekISO snaps back to the week start Monday (default)", () => {
    expect(startOfWeekISO("2026-06-01")).toBe("2026-06-01");
    expect(startOfWeekISO("2026-06-03")).toBe("2026-06-01");
    expect(startOfWeekISO("2026-06-07")).toBe("2026-06-01");
    expect(startOfWeekISO("2026-05-31")).toBe("2026-05-25");
  });

  it("startOfWeekISO respects weekStartsOn=0 (Sunday)", () => {
    expect(startOfWeekISO("2026-06-11", 0)).toBe("2026-06-07");
    expect(startOfWeekISO("2026-06-07", 0)).toBe("2026-06-07");
    expect(startOfWeekISO("2026-06-08", 0)).toBe("2026-06-07");
  });

  it("isWithin is inclusive of both ends", () => {
    expect(isWithin("2026-05-10", "2026-05-01", "2026-05-31")).toBe(true);
    expect(isWithin("2026-05-01", "2026-05-01", "2026-05-31")).toBe(true);
    expect(isWithin("2026-05-31", "2026-05-01", "2026-05-31")).toBe(true);
    expect(isWithin("2026-06-01", "2026-05-01", "2026-05-31")).toBe(false);
  });

  it("rangesOverlap is inclusive at both ends of both ranges", () => {
    expect(rangesOverlap("2026-05-01", "2026-05-31", "2026-05-10", "2026-05-12")).toBe(true);
    expect(rangesOverlap("2026-05-01", "2026-05-10", "2026-05-10", "2026-05-20")).toBe(true);
    expect(rangesOverlap("2026-05-10", "2026-05-20", "2026-05-01", "2026-05-10")).toBe(true);
    expect(rangesOverlap("2026-05-01", "2026-05-09", "2026-05-10", "2026-05-20")).toBe(false);
    expect(rangesOverlap("2026-05-21", "2026-05-30", "2026-05-10", "2026-05-20")).toBe(false);
  });

  it("toISODate/parseDate round-trip", () => {
    expect(toISODate(parseDate("2026-05-29"))).toBe("2026-05-29");
  });

  it("rejects extended and derived five-digit years before they can masquerade as ISODate", () => {
    expect(() => toISODate(parseDate("+012026-06-01"))).toThrow(/four-digit ISO year range/i);
    expect(() => addDaysISO("9999-12-31", 1)).toThrow(/four-digit ISO year range/i);
  });
});

describe("isWeekendAware", () => {
  it("is false when workingDays is empty (no boundary at length > 0 to cross)", () => {
    expect(isWeekendAware([], false)).toBe(false);
  });

  it("is false for a full 7-day working week (no boundary at length < 7 to cross)", () => {
    expect(isWeekendAware([0, 1, 2, 3, 4, 5, 6], false)).toBe(false);
  });

  it("is true for a genuine partial week (both boundaries cleared)", () => {
    expect(isWeekendAware([1, 2, 3, 4, 5], false)).toBe(true);
  });

  it("uses distinct weekdays when malformed input repeats a day", () => {
    expect(isWeekendAware([0, 1, 2, 3, 4, 5, 5], false)).toBe(true);
    expect(isWeekendAware([0, 1, 2, 3, 4, 5, 6, 6], false)).toBe(false);
  });
});

describe("countWorkingDays", () => {
  it("returns 0 for a reversed (empty) range regardless of how far reversed", () => {
    expect(countWorkingDays("2026-06-02", "2026-06-01", [1, 2, 3, 4, 5])).toBe(0);
    expect(countWorkingDays("2026-06-10", "2026-06-01", [1, 2, 3, 4, 5])).toBe(0);
  });

  it("matches a date-string scan across starts, spans and working-week patterns", () => {
    const reference = (start: string, end: string, workingDays: Weekday[]): number => {
      const span = daysInclusive(start, end);
      let count = 0;
      for (let i = 0; i < span; i++) {
        if (workingDays.includes(weekdayOf(addDaysISO(start, i)))) count++;
      }
      return count;
    };
    const patterns: Weekday[][] = [
      [],
      [1, 2, 3, 4, 5],
      [0, 6],
      [1, 3, 5],
      [2],
      [1, 1, 1],
      [0, 1, 2, 3, 4, 5],
      [0, 1, 2, 3, 4, 5, 6],
    ];
    for (let startOffset = 0; startOffset < 7; startOffset++) {
      // The loop covers leap day and every possible start weekday.
      const start = addDaysISO("2024-02-25", startOffset);
      for (const span of [1, 2, 7, 31, 366]) {
        const end = addDaysISO(start, span - 1);
        for (const pattern of patterns) {
          expect(countWorkingDays(start, end, pattern)).toBe(reference(start, end, pattern));
        }
      }
    }
  });
});

describe("endDateForWorkingDays", () => {
  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects a non-safe-integer working-day count (%s)", (count) => {
    expect(() => endDateForWorkingDays("2026-06-01", count, [1, 2, 3, 4, 5])).toThrow("count must be a safe integer.");
  });

  it.each([{ days: [7] }, { days: [1, 7] }])(
    "fails loudly when the weekday set contains an out-of-range value ($days)",
    ({ days }) => {
      expect(() => endDateForWorkingDays("2026-06-01", 5, days as Weekday[])).toThrow(
        "workingDays must contain only integer weekdays from 0 through 6.",
      );
    },
  );

  it("falls back to the raw calendar span (start itself) when count <= 0", () => {
    expect(endDateForWorkingDays("2026-06-01", 0, [1, 2, 3, 4, 5])).toBe("2026-06-01");
    expect(endDateForWorkingDays("2026-06-01", -3, [1, 2, 3, 4, 5])).toBe("2026-06-01");
  });

  it("falls back to the raw calendar span when workingDays is empty", () => {
    // count=5 -> 5th calendar day at/after start = start + 4.
    expect(endDateForWorkingDays("2026-06-01", 5, [])).toBe("2026-06-05");
  });

  it("uses distinct weekdays rather than array length for duplicate-bearing input", () => {
    expect(endDateForWorkingDays("2026-06-01", 5, [1, 1, 1, 1, 1, 1, 1])).toBe("2026-06-29");
  });

  it("lands on the count-th working day at/after start", () => {
    // 2026-06-01 is a Monday; Mon–Fri working week.
    // A one-day allocation ends on its start date.
    expect(endDateForWorkingDays("2026-06-01", 1, [1, 2, 3, 4, 5])).toBe("2026-06-01");
    // Five working days end on Friday.
    expect(endDateForWorkingDays("2026-06-01", 5, [1, 2, 3, 4, 5])).toBe("2026-06-05");
    // Six working days end on the following Monday.
    expect(endDateForWorkingDays("2026-06-01", 6, [1, 2, 3, 4, 5])).toBe("2026-06-08");
  });
});

describe("endDateForWorkingDays edge cases", () => {
  it("skips forward when start is itself a non-working day", () => {
    // 2026-06-06 is a Saturday; the 1st working day at/after it is Mon 2026-06-08.
    expect(endDateForWorkingDays("2026-06-06", 1, [1, 2, 3, 4, 5])).toBe("2026-06-08");
  });

  it("handles a sparse working week (Mon/Wed/Fri) using DISTINCT weekdays", () => {
    // From Mon 2026-06-01: Mon(1) Wed(3) Fri(5) Mon(8) → the 4th working day is 2026-06-08.
    expect(endDateForWorkingDays("2026-06-01", 4, [1, 3, 5])).toBe("2026-06-08");
    // Degenerate [1,1,1] (length 3, only Mondays): the 3rd Monday from 2026-06-01.
    expect(endDateForWorkingDays("2026-06-01", 3, [1, 1, 1])).toBe("2026-06-15");
  });

  it("matches a brute-force day-scan across a matrix of starts/patterns/counts", () => {
    // Compare the closed form with an independent day-by-day oracle across starts and workweek shapes.
    const reference = (start: string, count: number, workingDays: Weekday[]): string => {
      const distinctWorkingDays = new Set(workingDays);
      if (count <= 0 || distinctWorkingDays.size === 0 || distinctWorkingDays.size >= 7) {
        return addDaysISO(start, Math.max(0, count - 1));
      }
      const maxScan = count * 7 + 7;
      let found = 0;
      for (let i = 0; i < maxScan; i++) {
        const day = addDaysISO(start, i);
        if (distinctWorkingDays.has(weekdayOf(day))) {
          found++;
          if (found === count) return day;
        }
      }
      return addDaysISO(start, maxScan - 1);
    };
    const patterns: Weekday[][] = [
      [1, 2, 3, 4, 5],
      [0, 6],
      [1, 3, 5],
      [2],
      // Repeated weekdays count only once.
      [1, 1, 1],
      // This pattern includes every day except Saturday.
      [0, 1, 2, 3, 4, 5],
    ];
    for (let s = 0; s < 7; s++) {
      const start = addDaysISO("2026-06-01", s);
      for (const pattern of patterns) {
        for (let count = 1; count <= 40; count++) {
          expect(endDateForWorkingDays(start, count, pattern)).toBe(reference(start, count, pattern));
        }
      }
    }
  });
});
