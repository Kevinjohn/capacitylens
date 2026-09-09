import { addDaysISO, daysInclusive, MAX_ISO_DATE, weekdayOf } from "./dateMath";
import { daysInMonth as daysInGregorianMonth, isValidISODate } from "./integrity";
import type { ISODate } from "../types/entities";

/** A supported repeat cadence for transient dated-entry creation. */
export type RepeatPattern =
  { kind: "weeks"; interval: 1 | 2 | 3 | 4 } | { kind: "monthly-date" } | { kind: "monthly-last-weekday" };

/** Caller-owned limits for the common date generation rules. */
export interface RepeatingDatePolicy {
  /** Calendar months after the start that the inclusive cutoff may reach. */
  maximumCalendarMonths: number;
  /** Whether the maximum cutoff preserves the anchor day or ends its target month. */
  maximumCutoff: "anchor-day" | "month-end";
  /** Calendar months after the start used for a newly enabled repeat suggestion. */
  defaultCalendarMonths: number;
  /** Whether the suggested cutoff preserves the anchor day or ends its target month. */
  defaultCutoff: "anchor-day" | "month-end";
  /** Inclusive maximum number of generated entries, including the original anchor. */
  maxOccurrences: number;
  /** Stable noun used in the defensive occurrence-limit message. */
  occurrenceNoun: string;
}

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

/** Existing allocation behavior, kept as the default for every public helper. */
export const ALLOCATION_REPEAT_POLICY: RepeatingDatePolicy = {
  maximumCalendarMonths: MAX_REPEAT_MONTHS,
  maximumCutoff: "anchor-day",
  defaultCalendarMonths: DEFAULT_REPEAT_MONTHS,
  defaultCutoff: "month-end",
  maxOccurrences: GENERATED_ALLOCATION_LIMIT,
  occurrenceNoun: "allocation",
};

/** Personal time-off behavior: the initial month plus eleven following calendar months. */
export const TIME_OFF_REPEAT_POLICY: RepeatingDatePolicy = {
  maximumCalendarMonths: 11,
  maximumCutoff: "month-end",
  defaultCalendarMonths: 11,
  defaultCutoff: "month-end",
  maxOccurrences: 54,
  occurrenceNoun: "entry",
};

export type RepeatingDateErrorCode =
  | "invalid-date"
  | "cutoff-before-start"
  | "cutoff-after-limit"
  | "unsupported-pattern"
  | "occurrence-limit"
  | "no-repeat"
  | "invalid-last-weekday-start";

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
function countDaysInMonth(year: number, month: number): number {
  if (!Number.isSafeInteger(year) || year < FIRST_SUPPORTED_YEAR || year > LAST_SUPPORTED_YEAR) {
    throw new RangeError("Date falls outside the supported four-digit ISO year range.");
  }
  if (!Number.isSafeInteger(month) || month < 1 || month > MONTHS_PER_YEAR) {
    throw new RangeError("Month must be a whole number from 1 through 12.");
  }
  return daysInGregorianMonth(year, month);
}

function buildIsoDate(year: number, month: number, day: number): ISODate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDateParts(date: ISODate): { year: number; month: number; day: number } {
  if (!isValidISODate(date)) {
    throw new RepeatingDateError("invalid-date", "Repeat dates must be valid zero-padded ISO dates.");
  }
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  };
}

/** Latest valid user cutoff for the selected caller policy, capped by the ISO date domain. */
export function maximumRepeatUntilDate(
  startDate: ISODate,
  policy: RepeatingDatePolicy = ALLOCATION_REPEAT_POLICY,
): ISODate {
  parseDateParts(startDate);
  try {
    const target = addCalendarMonthsClamped(startDate, policy.maximumCalendarMonths);
    return policy.maximumCutoff === "month-end" ? endOfCalendarMonth(target) : target;
  } catch (error) {
    if (error instanceof RangeError) return MAX_ISO_DATE;
    throw error;
  }
}

/** Suggested cutoff for a newly enabled repeat: the end of the month two calendar months after
 *  the allocation start (August -> 31 October). Near the supported date ceiling it is clamped to
 *  the same maximum accepted by the form, so revealing the field never creates invalid state. */
export function defaultRepeatUntilDate(
  startDate: ISODate,
  policy: RepeatingDatePolicy = ALLOCATION_REPEAT_POLICY,
): ISODate {
  const maximum = maximumRepeatUntilDate(startDate, policy);
  let suggested: ISODate;
  try {
    // Reuse the ONE absolute-month implementation to land in the target month, then take that
    // month's last day (the day-of-month the clamped add lands on is irrelevant here).
    const target = addCalendarMonthsClamped(startDate, policy.defaultCalendarMonths);
    suggested = policy.defaultCutoff === "month-end" ? endOfCalendarMonth(target) : target;
  } catch (error) {
    // Past the domain ceiling there is no "two months on" month left to end on, so the last
    // supported date IS the bounded suggestion — the same value the maximum clamps to. Clamping
    // rather than throwing is load-bearing: revealing the field must never create invalid state.
    if (error instanceof RangeError) suggested = MAX_ISO_DATE;
    else throw error;
  }
  return suggested > maximum ? maximum : suggested;
}

/** Latest valid personal time-off cutoff, including the initial month in its twelve-month horizon. */
export function maximumTimeOffRepeatUntilDate(startDate: ISODate): ISODate {
  return maximumRepeatUntilDate(startDate, TIME_OFF_REPEAT_POLICY);
}

/** Suggested personal time-off cutoff: the final day of its twelve-calendar-month horizon. */
export function defaultTimeOffRepeatUntilDate(startDate: ISODate): ISODate {
  return defaultRepeatUntilDate(startDate, TIME_OFF_REPEAT_POLICY);
}

function addCalendarMonthsClamped(date: ISODate, months: number): ISODate {
  if (!Number.isSafeInteger(months)) throw new RangeError("Calendar-month offset must be a safe integer.");
  const { year, month, day } = parseDateParts(date);
  const absoluteMonth = (year - 1) * MONTHS_PER_YEAR + (month - 1) + months;
  const lastAbsoluteMonth = LAST_SUPPORTED_YEAR * MONTHS_PER_YEAR - 1;
  if (absoluteMonth < 0 || absoluteMonth > lastAbsoluteMonth) {
    throw new RangeError("Repeating dates extend beyond the supported four-digit ISO year range.");
  }
  const targetYear = Math.floor(absoluteMonth / MONTHS_PER_YEAR) + 1;
  const targetMonth = (absoluteMonth % MONTHS_PER_YEAR) + 1;
  return buildIsoDate(targetYear, targetMonth, Math.min(day, countDaysInMonth(targetYear, targetMonth)));
}

function endOfCalendarMonth(date: ISODate): ISODate {
  const { year, month } = parseDateParts(date);
  return buildIsoDate(year, month, countDaysInMonth(year, month));
}

function applyRepeatingStartDate(startDates: ISODate[], candidate: ISODate, policy: RepeatingDatePolicy): ISODate[] {
  const previous = startDates.at(-1);
  if (previous !== undefined && candidate <= previous) {
    throw new Error("Repeating allocation dates must be strictly increasing.");
  }
  if (startDates.length >= policy.maxOccurrences) {
    throw new RepeatingDateError(
      "occurrence-limit",
      `Repeating ${policy.occurrenceNoun} generation exceeds its ${policy.maxOccurrences}-${policy.occurrenceNoun} limit.`,
    );
  }
  return [...startDates, candidate];
}

function buildWeeklyStartDates(startDate: ISODate, repeatUntil: ISODate, interval: number): ISODate[] {
  if (![1, 2, 3, 4].includes(interval)) {
    throw new RepeatingDateError("unsupported-pattern", "Repeat week interval is not supported.");
  }
  const startDates: ISODate[] = [];
  const intervalDays = interval * 7;
  const cutoffOffset = daysInclusive(startDate, repeatUntil) - 1;
  for (let index = 1; index * intervalDays <= cutoffOffset; index += 1) {
    startDates.push(addDaysISO(startDate, index * intervalDays));
  }
  return startDates;
}

function buildMonthlyCandidate(startDate: ISODate, monthOffset: number): ISODate | undefined {
  try {
    return addCalendarMonthsClamped(startDate, monthOffset);
  } catch (error) {
    if (error instanceof RangeError) return undefined;
    throw error;
  }
}

function buildMonthlyStartDates(startDate: ISODate, repeatUntil: ISODate, policy: RepeatingDatePolicy): ISODate[] {
  const startDates: ISODate[] = [];
  for (let monthOffset = 1; monthOffset <= policy.maximumCalendarMonths; monthOffset += 1) {
    const candidate = buildMonthlyCandidate(startDate, monthOffset);
    if (candidate === undefined || candidate > repeatUntil) break;
    startDates.push(candidate);
  }
  return startDates;
}

function lastMatchingWeekdayOfMonth(year: number, month: number, weekday: number): ISODate {
  const lastDay = countDaysInMonth(year, month);
  const lastDate = buildIsoDate(year, month, lastDay);
  const daysBack = (weekdayOf(lastDate) - weekday + 7) % 7;
  return buildIsoDate(year, month, lastDay - daysBack);
}

function buildMonthlyLastWeekdayStartDates(
  startDate: ISODate,
  repeatUntil: ISODate,
  policy: RepeatingDatePolicy,
): ISODate[] {
  const { year, month } = parseDateParts(startDate);
  const weekday = weekdayOf(startDate);
  if (lastMatchingWeekdayOfMonth(year, month, weekday) !== startDate) {
    throw new RepeatingDateError(
      "invalid-last-weekday-start",
      "Monthly last-weekday repeats must start on the last matching weekday of the month.",
    );
  }

  const startDates: ISODate[] = [];
  for (let monthOffset = 1; monthOffset <= policy.maximumCalendarMonths; monthOffset += 1) {
    const monthAnchor = buildMonthlyCandidate(startDate, monthOffset);
    if (monthAnchor === undefined) break;
    const target = parseDateParts(monthAnchor);
    const candidate = lastMatchingWeekdayOfMonth(target.year, target.month, weekday);
    if (candidate > repeatUntil) break;
    startDates.push(candidate);
  }
  return startDates;
}

/**
 * Generate repeat starts from a validated allocation start through the chosen inclusive cutoff.
 * Weekly candidates always derive from the original anchor; monthly candidates always reuse its numeric day.
 *
 * @param startDate validated, zero-padded ISO date in the years 0001 through 9999.
 * @param repeatUntil validated inclusive cutoff, no later than the selected policy horizon.
 * @param policy caller-specific horizon and occurrence limit; omitted for existing allocation behavior.
 * @param pattern supported weekly interval or original-calendar-date monthly cadence.
 * @throws RepeatingDateError when the dates, cutoff, pattern or generated count are invalid.
 * @throws Error when an internal ordering invariant is violated.
 */
// eslint-disable-next-line max-params -- The optional policy preserves the established three-argument allocation API.
export function generateRepeatingStartDates(
  startDate: ISODate,
  repeatUntil: ISODate,
  pattern: RepeatPattern,
  policy: RepeatingDatePolicy = ALLOCATION_REPEAT_POLICY,
): RepeatingDateResult {
  parseDateParts(startDate);
  parseDateParts(repeatUntil);
  if (repeatUntil < startDate) {
    throw new RepeatingDateError("cutoff-before-start", "Repeat until cannot be before the allocation start.");
  }
  if (repeatUntil > maximumRepeatUntilDate(startDate, policy)) {
    throw new RepeatingDateError(
      "cutoff-after-limit",
      `Repeat until cannot be more than ${policy.maximumCalendarMonths} calendar months after the allocation start.`,
    );
  }
  let startDates = applyRepeatingStartDate([], startDate, policy);
  const repeatedStartDates = (() => {
    switch (pattern.kind) {
      case "weeks":
        return buildWeeklyStartDates(startDate, repeatUntil, pattern.interval);
      case "monthly-date":
        return buildMonthlyStartDates(startDate, repeatUntil, policy);
      case "monthly-last-weekday":
        return buildMonthlyLastWeekdayStartDates(startDate, repeatUntil, policy);
      default:
        throw new RepeatingDateError(
          "unsupported-pattern",
          `Repeat pattern is not supported: ${JSON.stringify(pattern)}`,
        );
    }
  })();
  for (const candidate of repeatedStartDates) {
    startDates = applyRepeatingStartDate(startDates, candidate, policy);
  }

  if (startDates.length < 2) {
    throw new RepeatingDateError("no-repeat", "Repeat until must include at least one repeated occurrence.");
  }
  return { repeatUntil, startDates };
}
