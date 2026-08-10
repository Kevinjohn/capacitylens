import { addDaysISO, daysInclusive } from "./dateMath";
import { isValidISODate } from "./integrity";
import type { ISODate } from "../types/entities";

/** A supported repeat cadence for transient allocation creation. */
export type RepeatPattern = { kind: "weeks"; interval: 1 | 2 | 3 | 4 } | { kind: "monthly-date" };

/** The fixed three-month generation boundary and every included occurrence start. */
export interface RepeatingDateResult {
  windowEnd: ISODate;
  startDates: ISODate[];
}

const FIRST_SUPPORTED_YEAR = 1;
const LAST_SUPPORTED_YEAR = 9999;
const MONTHS_PER_YEAR = 12;
const REPEAT_WINDOW_MONTHS = 3;
const GENERATED_ALLOCATION_LIMIT = 16;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (!Number.isSafeInteger(year) || year < FIRST_SUPPORTED_YEAR || year > LAST_SUPPORTED_YEAR) {
    throw new RangeError("Date falls outside the supported four-digit ISO year range.");
  }
  if (!Number.isSafeInteger(month) || month < 1 || month > MONTHS_PER_YEAR) {
    throw new RangeError("Month must be a whole number from 1 through 12.");
  }
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function isoDate(year: number, month: number, day: number): ISODate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` as ISODate;
}

function dateParts(date: ISODate): { year: number; month: number; day: number } {
  if (!isValidISODate(date)) throw new RangeError("Repeat start date must be a valid zero-padded ISO date.");
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  };
}

function addCalendarMonthsClamped(date: ISODate, months: number): ISODate {
  if (!Number.isSafeInteger(months)) throw new RangeError("Calendar-month offset must be a safe integer.");
  const { year, month, day } = dateParts(date);
  const absoluteMonth = (year - 1) * MONTHS_PER_YEAR + (month - 1) + months;
  const lastAbsoluteMonth = LAST_SUPPORTED_YEAR * MONTHS_PER_YEAR - 1;
  if (absoluteMonth < 0 || absoluteMonth > lastAbsoluteMonth) {
    throw new RangeError("Repeating dates extend beyond the supported four-digit ISO year range.");
  }
  const targetYear = Math.floor(absoluteMonth / MONTHS_PER_YEAR) + 1;
  const targetMonth = (absoluteMonth % MONTHS_PER_YEAR) + 1;
  return isoDate(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
}

/**
 * Generate repeat starts from a validated allocation start through a clamped three-calendar-month window.
 * Weekly candidates always derive from the original anchor; monthly candidates always reuse its numeric day.
 *
 * @param startDate validated, zero-padded ISO date in the years 0001 through 9999.
 * @param pattern supported weekly interval or original-calendar-date monthly cadence.
 * @throws RangeError when the input/pattern leaves the supported ISO-date domain.
 * @throws Error when a defensive generation invariant is violated.
 */
export function generateRepeatingStartDates(startDate: ISODate, pattern: RepeatPattern): RepeatingDateResult {
  dateParts(startDate);
  const windowEnd = addCalendarMonthsClamped(startDate, REPEAT_WINDOW_MONTHS);
  const startDates: ISODate[] = [];
  const append = (candidate: ISODate) => {
    if (startDates.length > 0 && candidate <= startDates[startDates.length - 1]) {
      throw new Error("Repeating allocation dates must be strictly increasing.");
    }
    startDates.push(candidate);
    if (startDates.length >= GENERATED_ALLOCATION_LIMIT) {
      throw new Error(`Repeating allocation generation reached its ${GENERATED_ALLOCATION_LIMIT}-allocation limit.`);
    }
  };

  append(startDate);
  if (pattern.kind === "weeks") {
    if (![1, 2, 3, 4].includes(pattern.interval)) throw new RangeError("Repeat week interval is not supported.");
    const intervalDays = pattern.interval * 7;
    const windowOffset = daysInclusive(startDate, windowEnd) - 1;
    for (let index = 1; index * intervalDays <= windowOffset; index += 1) {
      append(addDaysISO(startDate, index * intervalDays));
    }
  } else if (pattern.kind === "monthly-date") {
    for (let index = 1; index <= REPEAT_WINDOW_MONTHS; index += 1) {
      const candidate = addCalendarMonthsClamped(startDate, index);
      if (candidate > windowEnd) break;
      append(candidate);
    }
  } else {
    const exhaustive: never = pattern;
    throw new RangeError(`Repeat pattern is not supported: ${JSON.stringify(exhaustive)}`);
  }

  if (startDates.length < 2) {
    throw new RangeError("The supported date range cannot accommodate another repeating allocation.");
  }
  return { windowEnd, startDates };
}
