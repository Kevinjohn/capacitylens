import { addDaysISO, countWorkingDays, daysInclusive, endDateForWorkingDays, isWeekendAware } from './dateMath'
import type { ISODate, Weekday } from '../types/entities'

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
  workingDays?: Weekday[]
  ignoreWeekends?: boolean
}

/** The "days over" span of [start, end]: working days when weekend-aware, else
 *  inclusive calendar days. Always >= 1 for a non-reversed range. */
export function spanDays(start: ISODate, end: ISODate, opts: DaysModeOpts): number {
  if (isWeekendAware(opts.workingDays, opts.ignoreWeekends)) {
    return countWorkingDays(start, end, opts.workingDays!)
  }
  return daysInclusive(start, end)
}

/** Inverse of `spanDays`: the end date such that [start, end] spans exactly
 *  `daysOver` days under the same working-day rule. */
export function endDateForSpan(start: ISODate, daysOver: number, opts: DaysModeOpts): ISODate {
  const n = Math.max(1, Math.round(daysOver))
  if (isWeekendAware(opts.workingDays, opts.ignoreWeekends)) {
    return endDateForWorkingDays(start, n, opts.workingDays!)
  }
  return addDaysISO(start, n - 1)
}

/** Hours/day needed to fit `daysOfWork` of effort into a `daysOver` span. */
export function hoursPerDayFor(daysOfWork: number, daysOver: number, workingHoursPerDay: number): number {
  if (daysOver <= 0) return 0
  return (workingHoursPerDay * daysOfWork) / daysOver
}

/** Inverse: the days-of-work implied by an allocation's hours/day over a span. */
export function daysOfWorkFor(hoursPerDay: number, daysOver: number, workingHoursPerDay: number): number {
  if (workingHoursPerDay <= 0) return 0
  return (hoursPerDay * daysOver) / workingHoursPerDay
}

/** Fraction of a working day a "blocks"-mode allocation consumes. Blocks are pure
 *  bookings — the span is all that matters, so load is 0 for now. Kept as a single
 *  named knob because user feedback may later make this configurable (e.g. 1 = 100%). */
export const BLOCK_LOAD_FRACTION = 0

/** Hours/day persisted for a blocks-mode allocation: the block's load fraction of
 *  the assignee's working day. At fraction 0 this is 0h, so a block never counts
 *  toward utilisation or over-capacity. */
export function blockHoursPerDay(workingHoursPerDay: number): number {
  return workingHoursPerDay * BLOCK_LOAD_FRACTION
}
