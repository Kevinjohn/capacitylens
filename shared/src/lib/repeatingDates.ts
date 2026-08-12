import { addDaysISO, daysInclusive } from "./dateMath";
import { isValidISODate } from "./integrity";
import type { ISODate } from "../types/entities";

/** A supported repeat cadence for transient allocation creation. */
export type RepeatPattern = { kind: "weeks"; interval: 1 | 2 | 3 | 4 } | { kind: "monthly-date" };

/** The chosen inclusive generation boundary and every included occurrence start. */
export interface RepeatingDateResult {
  repeatUntil: ISODate;
  startDates: ISODate[];
}

const FIRST_SUPPORTED_YEAR = 1;
const LAST_SUPPORTED_YEAR = 9999;
const MONTHS_PER_YEAR = 12;
const MAX_REPEAT_MONTHS = 6;
/** Defensive ceiling above the 27 weekly starts possible in a valid six-month window. */
export const GENERATED_ALLOCATION_LIMIT = 30;
const LAST_SUPPORTED_DATE = "9999-12-31" as ISODate;

export type RepeatingDateErrorCode =
  | "invalid-date"
  | "cutoff-before-start"
  | "cutoff-after-limit"
  | "unsupported-pattern"
  | "occurrence-limit"
  | "no-repeat";

/** Stable error classification for form validation without matching human-readable messages. */
export class RepeatingDateError extends RangeError {
  readonly code: RepeatingDateErrorCode;

  constructor(code: RepeatingDateErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "RepeatingDateError";
  }
}

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
  if (!isValidISODate(date)) {
    throw new RepeatingDateError("invalid-date", "Repeat dates must be valid zero-padded ISO dates.");
  }
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  };
}

/** Latest valid user cutoff: six calendar months after start, capped by the ISO date domain. */
export function maximumRepeatUntilDate(startDate: ISODate): ISODate {
  dateParts(startDate);
  try {
    return addCalendarMonthsClamped(startDate, MAX_REPEAT_MONTHS);
  } catch (error) {
    if (error instanceof RangeError) return LAST_SUPPORTED_DATE;
    throw error;
  }
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
 * Generate repeat starts from a validated allocation start through the chosen inclusive cutoff.
 * Weekly candidates always derive from the original anchor; monthly candidates always reuse its numeric day.
 *
 * @param startDate validated, zero-padded ISO date in the years 0001 through 9999.
 * @param repeatUntil validated inclusive cutoff, no later than six calendar months after start.
 * @param pattern supported weekly interval or original-calendar-date monthly cadence.
 * @throws RepeatingDateError when the dates, cutoff, pattern or generated count are invalid.
 * @throws Error when an internal ordering invariant is violated.
 */
export function generateRepeatingStartDates(
  startDate: ISODate,
  repeatUntil: ISODate,
  pattern: RepeatPattern,
): RepeatingDateResult {
  dateParts(startDate);
  dateParts(repeatUntil);
  if (repeatUntil < startDate) {
    throw new RepeatingDateError("cutoff-before-start", "Repeat until cannot be before the allocation start.");
  }
  if (repeatUntil > maximumRepeatUntilDate(startDate)) {
    throw new RepeatingDateError(
      "cutoff-after-limit",
      `Repeat until cannot be more than ${MAX_REPEAT_MONTHS} calendar months after the allocation start.`,
    );
  }
  const startDates: ISODate[] = [];
  const append = (candidate: ISODate) => {
    if (startDates.length > 0 && candidate <= startDates[startDates.length - 1]) {
      throw new Error("Repeating allocation dates must be strictly increasing.");
    }
    if (startDates.length >= GENERATED_ALLOCATION_LIMIT) {
      throw new RepeatingDateError(
        "occurrence-limit",
        `Repeating allocation generation exceeds its ${GENERATED_ALLOCATION_LIMIT}-allocation limit.`,
      );
    }
    startDates.push(candidate);
  };

  append(startDate);
  if (pattern.kind === "weeks") {
    if (![1, 2, 3, 4].includes(pattern.interval)) {
      throw new RepeatingDateError("unsupported-pattern", "Repeat week interval is not supported.");
    }
    const intervalDays = pattern.interval * 7;
    const cutoffOffset = daysInclusive(startDate, repeatUntil) - 1;
    for (let index = 1; index * intervalDays <= cutoffOffset; index += 1) {
      append(addDaysISO(startDate, index * intervalDays));
    }
  } else if (pattern.kind === "monthly-date") {
    for (let index = 1; index <= MAX_REPEAT_MONTHS; index += 1) {
      let candidate: ISODate;
      try {
        candidate = addCalendarMonthsClamped(startDate, index);
      } catch (error) {
        if (error instanceof RangeError) break;
        throw error;
      }
      if (candidate > repeatUntil) break;
      append(candidate);
      if (candidate === repeatUntil) break;
    }
  } else {
    const exhaustive: never = pattern;
    throw new RepeatingDateError(
      "unsupported-pattern",
      `Repeat pattern is not supported: ${JSON.stringify(exhaustive)}`,
    );
  }

  if (startDates.length < 2) {
    throw new RepeatingDateError("no-repeat", "Repeat until must include at least one repeated occurrence.");
  }
  return { repeatUntil, startDates };
}
