import { addDaysISO, countWorkingDays, daysInclusive, endDateForWorkingDays, isWeekendAware } from "./dateMath";
import type { ISODate, Weekday } from "../types/entities";

// Conversions for the "days" scheduling input mode. An allocation always stores
// startDate / endDate / hoursPerDay; this module is the single place that maps
// those to/from the (days-of-work, days-over) the user types in days mode.
//
//   days over   <-> the working-day span (endDate)
//   days of work = days over * (hoursPerDay / workingHoursPerDay)
//
// "Working day" is whatever isWeekendAware() decides for this allocation, so the
// span here and a drag in gestureMath always agree on the same count.

export interface DaysModeOpts {
  workingDays?: Weekday[];
  ignoreWeekends?: boolean;
}

/** Upper bound for a (days-over) span. ~100 working/calendar years — far beyond any real
 * allocation. endDateForSpan also clamps this against the days remaining in the four-digit ISO
 * date domain because the fixed cap alone cannot protect a start close to 9999-12-31. */
export const MAX_SPAN_DAYS = 36500;
const MAX_ISO_DATE: ISODate = "9999-12-31";

/** Maximum days-over value that can be derived from this start without leaving YYYY-MM-DD. */
export function maxSpanDaysForStart(start: ISODate, opts: DaysModeOpts): number {
  if (isWeekendAware(opts.workingDays, opts.ignoreWeekends)) {
    return countWorkingDays(start, MAX_ISO_DATE, opts.workingDays!);
  }
  return daysInclusive(start, MAX_ISO_DATE);
}

/** The "days over" span of [start, end]: working days when weekend-aware, else
 *  inclusive calendar days. Always >= 1 for a non-reversed range. */
export function spanDays(start: ISODate, end: ISODate, opts: DaysModeOpts): number {
  if (isWeekendAware(opts.workingDays, opts.ignoreWeekends)) {
    return countWorkingDays(start, end, opts.workingDays!);
  }
  return daysInclusive(start, end);
}

/** Inverse of `spanDays`: the end date such that [start, end] spans exactly
 *  `daysOver` days under the same working-day rule. Interactive callers validate a whole-number
 *  domain value first; the clamp remains a defensive boundary for imported/programmatic input. */
export function endDateForSpan(start: ISODate, daysOver: number, opts: DaysModeOpts): ISODate {
  // Clamp first to the product span, then to the days actually available before 9999-12-31. A
  // partial working week may expand 36,500 work days across far more calendar days, so the second
  // bound must use the same weekend-awareness as the derivation.
  const n = Math.min(Math.max(1, Math.round(daysOver) || 1), MAX_SPAN_DAYS);
  const available = maxSpanDaysForStart(start, opts);
  if (available < 1) return MAX_ISO_DATE;
  const safeCount = Math.min(n, available);
  if (isWeekendAware(opts.workingDays, opts.ignoreWeekends)) {
    return endDateForWorkingDays(start, safeCount, opts.workingDays!);
  }
  return addDaysISO(start, safeCount - 1);
}

/** Hours/day needed to fit `daysOfWork` of effort into a `daysOver` span. */
export function hoursPerDayFor(daysOfWork: number, daysOver: number, workingHoursPerDay: number): number {
  if (daysOver <= 0) return 0;
  return (workingHoursPerDay * daysOfWork) / daysOver;
}

/** Inverse: the days-of-work implied by an allocation's hours/day over a span. */
export function daysOfWorkFor(hoursPerDay: number, daysOver: number, workingHoursPerDay: number): number {
  if (workingHoursPerDay <= 0) return 0;
  return (hoursPerDay * daysOver) / workingHoursPerDay;
}

/** Fraction of a working day a "blocks"-mode allocation consumes. Blocks are pure
 *  bookings — the span is all that matters, so load is 0 for now. Kept as a single
 *  named knob because user feedback may later make this configurable (e.g. 1 = 100%). */
export const BLOCK_LOAD_FRACTION = 0;

/** Hours/day persisted for a blocks-mode allocation: the block's load fraction of
 *  the assignee's working day. At fraction 0 this is 0h, so a block never counts
 *  toward utilisation or over-capacity. */
export function blockHoursPerDay(workingHoursPerDay: number): number {
  return workingHoursPerDay * BLOCK_LOAD_FRACTION;
}
