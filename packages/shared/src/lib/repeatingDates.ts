import { addDaysISO, daysInclusive, MAX_ISO_DATE, weekdayOf } from './dateMath.js';
import { daysInMonth as daysInGregorianMonth, isValidISODate } from './isoDates.js';
import type { ISODate } from '../types/entities.js';

/** A supported repeat cadence for transient dated-entry creation. */
export type RepeatPattern =
  | { kind: 'weeks'; interval: 1 | 2 | 3 | 4 }
  | { kind: 'monthly-date' }
  | { kind: 'monthly-last-weekday' };

/** Caller-owned limits for the common date generation rules. */
export interface RepeatingDatePolicy {
  /** Calendar months after the start that the inclusive cutoff may reach. */
  maximumCalendarMonths: number;
  /** Whether the maximum cutoff preserves the anchor day or ends its target month. */
  maximumCutoff: 'anchor-day' | 'month-end';
  /** Calendar months after the start used for a newly enabled repeat suggestion. */
  defaultCalendarMonths: number;
  /** Whether the suggested cutoff preserves the anchor day or ends its target month. */
  defaultCutoff: 'anchor-day' | 'month-end';
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

const LAST_SUPPORTED_YEAR = 9999;
const MONTHS_PER_YEAR = 12;
const MAX_REPEAT_MONTHS = 6;
/** Defensive ceiling above the 27 weekly starts possible in a valid six-month window. */
export const GENERATED_ALLOCATION_LIMIT = 30;
// Allocation repeat suggestions use two calendar months.
const DEFAULT_REPEAT_MONTHS = 2;

/** Existing allocation behavior, kept as the default for every public helper. */
export const ALLOCATION_REPEAT_POLICY: RepeatingDatePolicy = {
  maximumCalendarMonths: MAX_REPEAT_MONTHS,
  maximumCutoff: 'anchor-day',
  defaultCalendarMonths: DEFAULT_REPEAT_MONTHS,
  defaultCutoff: 'month-end',
  maxOccurrences: GENERATED_ALLOCATION_LIMIT,
  occurrenceNoun: 'allocation',
};

/** Personal time-off behavior: the initial month plus eleven following calendar months. */
export const TIME_OFF_REPEAT_POLICY: RepeatingDatePolicy = {
  maximumCalendarMonths: 11,
  maximumCutoff: 'month-end',
  defaultCalendarMonths: 11,
  defaultCutoff: 'month-end',
  maxOccurrences: 54,
  occurrenceNoun: 'entry',
};

/** Why a repeating-date request cannot produce dates. */
export type RepeatingDateErrorCode =
  | 'invalid-date'
  | 'cutoff-before-start'
  | 'cutoff-after-limit'
  | 'unsupported-pattern'
  | 'occurrence-limit'
  | 'no-repeat'
  | 'invalid-last-weekday-start';

/** Stable error classification for form validation without matching human-readable messages. */
export class RepeatingDateError extends RangeError {
  readonly code: RepeatingDateErrorCode;

  constructor(code: RepeatingDateErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'RepeatingDateError';
  }
}

function buildIsoDate(year: number, month: number, day: number): ISODate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseDateParts(date: ISODate): { year: number; month: number; day: number } {
  if (!isValidISODate(date)) {
    throw new RepeatingDateError(
      'invalid-date',
      'Repeat dates must be valid zero-padded ISO dates.',
    );
  }
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  };
}

/** Latest valid user cutoff for the selected caller policy, capped by the ISO date domain.
 * Pure; startDate must be a validated ISO date.
 * @throws RepeatingDateError for an invalid start date; no cutoff is returned. */
export function maximumRepeatUntilDate(
  startDate: ISODate,
  policy: RepeatingDatePolicy = ALLOCATION_REPEAT_POLICY,
): ISODate {
  parseDateParts(startDate);
  const target = addCalendarMonthsClamped(startDate, policy.maximumCalendarMonths);
  // Clamp a range beyond the supported calendar to its final date.
  if (target === undefined) return MAX_ISO_DATE;
  return policy.maximumCutoff === 'month-end' ? endOfCalendarMonth(target) : target;
}

/** Suggest the selected policy’s default cutoff, bounded by its maximum and the four-digit ISO date domain.
 * Pure; the policy supplies valid month offsets and cutoff modes.
 * @throws RepeatingDateError when startDate is not a validated ISO date; no cutoff is returned. */
export function defaultRepeatUntilDate(
  startDate: ISODate,
  policy: RepeatingDatePolicy = ALLOCATION_REPEAT_POLICY,
): ISODate {
  const maximum = maximumRepeatUntilDate(startDate, policy);
  // Resolve the target month before applying the selected anchor-day or month-end cutoff policy.
  const target = addCalendarMonthsClamped(startDate, policy.defaultCalendarMonths);
  // Clamp an out-of-domain suggestion to the last supported date so enabling repeat never creates an invalid date.
  let suggested: ISODate = MAX_ISO_DATE;
  if (target !== undefined) {
    suggested = policy.defaultCutoff === 'month-end' ? endOfCalendarMonth(target) : target;
  }
  return suggested > maximum ? maximum : suggested;
}

/** Latest valid personal time-off cutoff, including the initial month in its twelve-month horizon.
 * Pure; startDate must be a validated ISO date.
 * @throws RepeatingDateError for an invalid start date; no cutoff is returned. */
export function maximumTimeOffRepeatUntilDate(startDate: ISODate): ISODate {
  return maximumRepeatUntilDate(startDate, TIME_OFF_REPEAT_POLICY);
}

/** Suggested personal time-off cutoff at the end of its twelve-calendar-month horizon.
 * Pure; startDate must be a validated ISO date.
 * @throws RepeatingDateError for an invalid start date; no cutoff is returned. */
export function defaultTimeOffRepeatUntilDate(startDate: ISODate): ISODate {
  return defaultRepeatUntilDate(startDate, TIME_OFF_REPEAT_POLICY);
}

// Undefined when the offset is not a safe integer or the target month falls outside the
// supported four-digit ISO years, so callers clamp instead of emitting an unsupported date.
function addCalendarMonthsClamped(date: ISODate, months: number): ISODate | undefined {
  if (!Number.isSafeInteger(months)) return undefined;
  const { year, month, day } = parseDateParts(date);
  const absoluteMonth = (year - 1) * MONTHS_PER_YEAR + (month - 1) + months;
  const lastAbsoluteMonth = LAST_SUPPORTED_YEAR * MONTHS_PER_YEAR - 1;
  if (absoluteMonth < 0 || absoluteMonth > lastAbsoluteMonth) return undefined;
  const targetYear = Math.floor(absoluteMonth / MONTHS_PER_YEAR) + 1;
  const targetMonth = (absoluteMonth % MONTHS_PER_YEAR) + 1;
  return buildIsoDate(
    targetYear,
    targetMonth,
    Math.min(day, daysInGregorianMonth(targetYear, targetMonth)),
  );
}

function endOfCalendarMonth(date: ISODate): ISODate {
  const { year, month } = parseDateParts(date);
  return buildIsoDate(year, month, daysInGregorianMonth(year, month));
}

function applyRepeatingStartDate(
  startDates: ISODate[],
  candidate: ISODate,
  policy: RepeatingDatePolicy,
): ISODate[] {
  const previous = startDates.at(-1);
  if (previous !== undefined && candidate <= previous) {
    throw new Error('Repeating allocation dates must be strictly increasing.');
  }
  if (startDates.length >= policy.maxOccurrences) {
    throw new RepeatingDateError(
      'occurrence-limit',
      `Repeating ${policy.occurrenceNoun} generation exceeds its ${policy.maxOccurrences}-${policy.occurrenceNoun} limit.`,
    );
  }
  return [...startDates, candidate];
}

function buildWeeklyStartDates(
  startDate: ISODate,
  repeatUntil: ISODate,
  interval: number,
): ISODate[] {
  if (![1, 2, 3, 4].includes(interval)) {
    throw new RepeatingDateError('unsupported-pattern', 'Repeat week interval is not supported.');
  }
  const startDates: ISODate[] = [];
  const intervalDays = interval * 7;
  const cutoffOffset = daysInclusive(startDate, repeatUntil) - 1;
  for (let index = 1; index * intervalDays <= cutoffOffset; index += 1) {
    startDates.push(addDaysISO(startDate, index * intervalDays));
  }
  return startDates;
}

function buildMonthlyStartDates(
  startDate: ISODate,
  repeatUntil: ISODate,
  policy: RepeatingDatePolicy,
): ISODate[] {
  const startDates: ISODate[] = [];
  for (let monthOffset = 1; monthOffset <= policy.maximumCalendarMonths; monthOffset += 1) {
    const candidate = addCalendarMonthsClamped(startDate, monthOffset);
    if (candidate === undefined || candidate > repeatUntil) break;
    startDates.push(candidate);
  }
  return startDates;
}

function lastMatchingWeekdayOfMonth(year: number, month: number, weekday: number): ISODate {
  const lastDay = daysInGregorianMonth(year, month);
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
      'invalid-last-weekday-start',
      'Monthly last-weekday repeats must start on the last matching weekday of the month.',
    );
  }

  const startDates: ISODate[] = [];
  for (let monthOffset = 1; monthOffset <= policy.maximumCalendarMonths; monthOffset += 1) {
    const monthAnchor = addCalendarMonthsClamped(startDate, monthOffset);
    if (monthAnchor === undefined) break;
    const target = parseDateParts(monthAnchor);
    const candidate = lastMatchingWeekdayOfMonth(target.year, target.month, weekday);
    if (candidate > repeatUntil) break;
    startDates.push(candidate);
  }
  return startDates;
}

/** Generate repeat starts through the selected inclusive cutoff without mutating inputs.
 * Weekly starts derive from the original anchor. Monthly-date starts preserve its numeric day, clamped to each month’s end.
 * Monthly-last-weekday starts use the last matching weekday of each month; the anchor must itself be that month’s last matching weekday.
 * @param startDate validated, zero-padded ISO date in the years 0001 through 9999.
 * @param repeatUntil validated inclusive cutoff no later than the selected policy horizon.
 * @param policy caller-specific horizon and occurrence limit; defaults to allocation policy.
 * @param pattern weekly, original-calendar-date monthly or last-weekday monthly cadence.
 * @throws RepeatingDateError when dates, cutoff, pattern, last-weekday anchor or generated count are invalid; no starts are returned.
 * @throws Error when an internal ordering invariant is violated.
 */
export function generateRepeatingStartDates(
  startDate: ISODate,
  repeatUntil: ISODate,
  pattern: RepeatPattern,
  policy: RepeatingDatePolicy = ALLOCATION_REPEAT_POLICY,
): RepeatingDateResult {
  parseDateParts(startDate);
  parseDateParts(repeatUntil);
  if (repeatUntil < startDate) {
    throw new RepeatingDateError(
      'cutoff-before-start',
      'Repeat until cannot be before the allocation start.',
    );
  }
  if (repeatUntil > maximumRepeatUntilDate(startDate, policy)) {
    throw new RepeatingDateError(
      'cutoff-after-limit',
      `Repeat until cannot be more than ${policy.maximumCalendarMonths} calendar months after the allocation start.`,
    );
  }
  let startDates = applyRepeatingStartDate([], startDate, policy);
  const repeatedStartDates = (() => {
    switch (pattern.kind) {
      case 'weeks':
        return buildWeeklyStartDates(startDate, repeatUntil, pattern.interval);
      case 'monthly-date':
        return buildMonthlyStartDates(startDate, repeatUntil, policy);
      case 'monthly-last-weekday':
        return buildMonthlyLastWeekdayStartDates(startDate, repeatUntil, policy);
      default:
        throw new RepeatingDateError(
          'unsupported-pattern',
          `Repeat pattern is not supported: ${JSON.stringify(pattern)}`,
        );
    }
  })();
  for (const candidate of repeatedStartDates) {
    startDates = applyRepeatingStartDate(startDates, candidate, policy);
  }

  if (startDates.length < 2) {
    throw new RepeatingDateError(
      'no-repeat',
      'Repeat until must include at least one repeated occurrence.',
    );
  }
  return { repeatUntil, startDates };
}
