import { addDays, differenceInCalendarDays, format, parseISO, startOfWeek } from 'date-fns';
import type { ISODate, Weekday } from '../types/entities.js';

/** Defensive allocation ceiling for materialised date arrays (~100 calendar years).
 * Re-exported as `MAX_SPAN_DAYS` (schedulingDays), one number, two names. */
export const MAX_MATERIALISED_DAYS = 36_500;

/** Last date in the four-digit ISO year domain this module owns (see `assertFourDigitISODate`).
 * Every span/repeat ceiling clamps against this constant so the scheduling and repeat paths can
 * never disagree on where the calendar ends. */
export const MAX_ISO_DATE = '9999-12-31' as ISODate;

// All scheduler geometry is done in integer day-indices derived from date-only
// ISO strings. We never do millisecond Date math for positioning. That is the
// classic DST / timezone off-by-one bug. date-fns' calendar-day helpers are
// timezone-agnostic for our purposes.
//
// Precondition (load-bearing): every `ISODate` argument must be a validated,
// zero-padded "YYYY-MM-DD" string. These helpers are pure and deliberately do not
// re-validate: `validateDateRange` (lib/integrity.ts, via `isValidISODate`) enforces
// it at every write boundary (store add/update, import remap, server validate), and
// import normalises dates on the way in. Pass an invalid/unpadded string and `parseISO`
// returns an Invalid Date whose downstream `format()` throws a RangeError. Extended-year input
// can parse, but `toISODate` rejects any output outside the four-digit product domain. Do not
// "harden" that by wrapping these in try/catch: it would swallow a real upstream bug in
// the hottest path. The guarantee lives at the boundary, by design.

/**
 * Parse a validated date-only ISO string ("YYYY-MM-DD") to a local Date at midnight.
 *
 * @param date a validated `ISODate` (see the module precondition above). An invalid or
 * unpadded string parses to an **Invalid Date**, which makes a later `format()`/`toISODate`
 * throw a RangeError, surface that as the upstream-validation bug it is, don't catch it here.
 */
export function parseDate(date: ISODate): Date {
  return parseISO(date);
}

/**
 * Returns the candidate as an `ISODate` when it has the four-digit, zero-padded shape.
 *
 * @throws `RangeError` for any other shape, so every out-of-domain year fails the same way.
 */
export function assertFourDigitISODate(candidate: string): ISODate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    throw new RangeError('Date falls outside the supported four-digit ISO year range.');
  }
  return candidate;
}

/** Format a Date back to a date-only ISO string within the four-digit product year domain. */
export function toISODate(date: Date): ISODate {
  return assertFourDigitISODate(format(date, 'yyyy-MM-dd'));
}

/** Whole-calendar-day offset of `date` from `origin` (may be negative).
 * Both args must be validated `ISODate`s (see the module precondition); an invalid one
 * yields `NaN` here, which the geometry callers (columnGeometry's `xForDateInGeom` /
 * `widthForDates`) `Number.isFinite`-guard to 0. */
export function dayIndex(date: ISODate, origin: ISODate): number {
  return differenceInCalendarDays(parseISO(date), parseISO(origin));
}

/** Add (or subtract, with a negative `days`) whole days to a date-only ISO string.
 * `date` must be a validated `ISODate` (see the module precondition), an invalid one
 * produces an Invalid Date and the inner `toISODate`/`format()` throws RangeError. */
export function addDaysISO(date: ISODate, days: number): ISODate {
  return toISODate(addDays(parseISO(date), days));
}

/** Inclusive day count of [start, end]: end - start + 1. Can be <= 0 if reversed. */
export function daysInclusive(start: ISODate, end: ISODate): number {
  return differenceInCalendarDays(parseISO(end), parseISO(start)) + 1;
}

/** Return a new array of validated ISO dates in the inclusive range; reversed ranges return an empty array.
 * Pure; inputs must be validated ISO dates.
 * @throws RangeError when the range exceeds MAX_MATERIALISED_DAYS or formatting leaves the supported date domain; no date array is returned. */
export function eachDayISO(start: ISODate, end: ISODate): ISODate[] {
  const count = daysInclusive(start, end);
  if (count <= 0) return [];
  if (count > MAX_MATERIALISED_DAYS) {
    throw new RangeError(
      `Date range exceeds the ${MAX_MATERIALISED_DAYS}-day materialisation limit.`,
    );
  }
  const out: ISODate[] = [];
  // Parse once because capacity-window calculations materialize many dates on the render path.
  let cursor = parseISO(start);
  for (let i = 0; i < count; i++) {
    out.push(toISODate(cursor));
    cursor = addDays(cursor, 1);
  }
  return out;
}

/** Weekday (0=Sun … 6=Sat) of a date-only ISO string. */
export function weekdayOf(date: ISODate): Weekday {
  return parseISO(date).getDay() as Weekday;
}

/** The start of the week containing `date`.
 * `weekStartsOn`: 0 = Sunday, 1 = Monday (default, ISO-style). */
export function startOfWeekISO(date: ISODate, weekStartsOn: 0 | 1 = 1): ISODate {
  return toISODate(startOfWeek(parseISO(date), { weekStartsOn }));
}

/** Is `date` within the inclusive range [start, end]? Zero-padded YYYY-MM-DD strings
 * sort chronologically, so a plain string compare is exact and avoids three parseISO
 * calls, and this is the scheduler's hottest path (called per resource × per day ×
 * per allocation when building day capacity). The zero-padding assumption is not just
 * convention: `validateDateRange` (integrity.ts) rejects any non-`YYYY-MM-DD` date at
 * every write boundary (store add/update, import remap, server validate), so an
 * unpadded date like "2026-6-1" can never reach this comparison. */
export function isWithin(date: ISODate, start: ISODate, end: ISODate): boolean {
  return date >= start && date <= end;
}

/** Do the two inclusive ranges [aStart, aEnd] and [bStart, bEnd] share at least one day?
 * Both ends are closed on both sides: a range that merely touches the other's edge
 * overlaps, which is what every caller (timeline intersection, keyboard-nudge visibility)
 * means by "still on screen". Same zero-padded lexicographic compare as `isWithin`, for the
 * same reason: exact, and no parseISO on a hot path. */
export function rangesOverlap(
  aStart: ISODate,
  aEnd: ISODate,
  bStart: ISODate,
  bEnd: ISODate,
): boolean {
  return aEnd >= bStart && aStart <= bEnd;
}

/** Index of the first entry of the sorted, de-duplicated `dates` that is >= `target`
 * (`dates.length` when every entry is earlier). Date-only ISO strings are zero-padded, so
 * lexicographic order is chronological order and a plain string compare is a valid ordering. */
function resolveFirstDateIndexAtOrAfter(dates: ISODate[], target: ISODate): number {
  let lowerIndex = 0;
  let upperIndex = dates.length;
  while (lowerIndex < upperIndex) {
    const middleIndex = (lowerIndex + upperIndex) >> 1;
    const middleDate = dates[middleIndex];
    if (middleDate !== undefined && middleDate < target) lowerIndex = middleIndex + 1;
    else upperIndex = middleIndex;
  }
  return lowerIndex;
}

/** Indexes each row under the queried dates it covers so capacity lookup reads only overlapping rows. Preserve source insertion order because floating-point sums depend on it. */
export function bucketByCoveredDate<T extends { startDate: ISODate; endDate: ISODate }>(
  rows: T[],
  dates: ISODate[],
): Map<ISODate, T[]> {
  const byDate = new Map<ISODate, T[]>();
  for (const row of rows) {
    for (let i = resolveFirstDateIndexAtOrAfter(dates, row.startDate); i < dates.length; i++) {
      const date = dates[i];
      if (date === undefined) continue;
      if (date > row.endDate) break;
      const list = byDate.get(date);
      if (list) list.push(row);
      else byDate.set(date, [row]);
    }
  }
  return byDate;
}
