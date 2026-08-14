import { addDaysISO, daysInclusive, MAX_ISO_DATE } from "./dateMath";
import { daysInMonth as daysInGregorianMonth, isValidISODate } from "./integrity";
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
/** Calendar months between an allocation start and the cutoff suggested when repeat is enabled. */
const DEFAULT_REPEAT_MONTHS = 2;

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

/** Range-guarded month length for this module's absolute-month arithmetic. The Gregorian leap rule
 *  and month table live ONCE, in integrity.ts (shared with `isValidISODate`); the guards here are
 *  this module's own contract — the month arithmetic below can compute an out-of-domain year, and
 *  these typed RangeErrors are what the callers catch to clamp instead of emitting a pseudo-date. */
function daysInMonth(year: number, month: number): number {
  if (!Number.isSafeInteger(year) || year < FIRST_SUPPORTED_YEAR || year > LAST_SUPPORTED_YEAR) {
    throw new RangeError("Date falls outside the supported four-digit ISO year range.");
  }
  if (!Number.isSafeInteger(month) || month < 1 || month > MONTHS_PER_YEAR) {
    throw new RangeError("Month must be a whole number from 1 through 12.");
  }
  return daysInGregorianMonth(year, month);
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
    if (error instanceof RangeError) return MAX_ISO_DATE;
    throw error;
  }
}

/** Suggested cutoff for a newly enabled repeat: the end of the month two calendar months after
 *  the allocation start (August -> 31 October). Near the supported date ceiling it is clamped to
 *  the same maximum accepted by the form, so revealing the field never creates invalid state. */
export function defaultRepeatUntilDate(startDate: ISODate): ISODate {
  const maximum = maximumRepeatUntilDate(startDate);
  let suggested: ISODate;
  try {
    // Reuse the ONE absolute-month implementation to land in the target month, then take that
    // month's last day (the day-of-month the clamped add lands on is irrelevant here).
    const { year, month } = dateParts(addCalendarMonthsClamped(startDate, DEFAULT_REPEAT_MONTHS));
    suggested = isoDate(year, month, daysInMonth(year, month));
  } catch (error) {
    // Past the domain ceiling there is no "two months on" month left to end on, so the last
    // supported date IS the bounded suggestion — the same value the maximum clamps to. Clamping
    // rather than throwing is load-bearing: revealing the field must never create invalid state.
    if (error instanceof RangeError) suggested = MAX_ISO_DATE;
    else throw error;
  }
  return suggested > maximum ? maximum : suggested;
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
