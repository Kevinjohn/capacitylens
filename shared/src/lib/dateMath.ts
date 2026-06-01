import { addDays, differenceInCalendarDays, format, parseISO, startOfWeek } from 'date-fns'
import type { ISODate, Weekday } from '../types/entities'

// All scheduler geometry is done in INTEGER day-indices derived from date-only
// ISO strings. We never do millisecond Date math for positioning — that is the
// classic DST / timezone off-by-one bug. date-fns' calendar-day helpers are
// timezone-agnostic for our purposes.

/** Parse a date-only ISO string ("YYYY-MM-DD") to a local Date at midnight. */
export function parseDate(date: ISODate): Date {
  return parseISO(date)
}

/** Format a Date back to a date-only ISO string. */
export function toISODate(date: Date): ISODate {
  return format(date, 'yyyy-MM-dd')
}

/** Whole-calendar-day offset of `date` from `origin` (may be negative). */
export function dayIndex(date: ISODate, origin: ISODate): number {
  return differenceInCalendarDays(parseISO(date), parseISO(origin))
}

/** Add (or subtract, with a negative `days`) whole days to a date-only ISO string. */
export function addDaysISO(date: ISODate, days: number): ISODate {
  return toISODate(addDays(parseISO(date), days))
}

/** Inclusive day count of [start, end]: end - start + 1. Can be <= 0 if reversed. */
export function daysInclusive(start: ISODate, end: ISODate): number {
  return differenceInCalendarDays(parseISO(end), parseISO(start)) + 1
}

/** Every date-only ISO string in [start, end], inclusive. Empty when end < start. */
export function eachDayISO(start: ISODate, end: ISODate): ISODate[] {
  const count = daysInclusive(start, end)
  if (count <= 0) return []
  const out: ISODate[] = []
  for (let i = 0; i < count; i++) out.push(addDaysISO(start, i))
  return out
}

/** Weekday (0=Sun … 6=Sat) of a date-only ISO string. */
export function weekdayOf(date: ISODate): Weekday {
  return parseISO(date).getDay() as Weekday
}

/** The Monday of the week containing `date` (weeks start Monday, ISO-style). */
export function startOfWeekISO(date: ISODate): ISODate {
  // weekStartsOn: 1 makes Monday the week start (date-fns defaults to Sunday).
  return toISODate(startOfWeek(parseISO(date), { weekStartsOn: 1 }))
}

/** Pixel x-offset of a date's left edge from the timeline origin.
 *  Returns 0 for an unparseable date so a bad record can't produce NaN geometry. */
export function xForDate(date: ISODate, origin: ISODate, dayWidth: number): number {
  const i = dayIndex(date, origin)
  return Number.isFinite(i) ? i * dayWidth : 0
}

/** Pixel width of an inclusive [start, end] range. Clamped to >= 0 so a reversed
 *  or unparseable range renders as a zero-width (harmless) bar, never negative. */
export function widthForRange(start: ISODate, end: ISODate, dayWidth: number): number {
  const n = daysInclusive(start, end)
  return Number.isFinite(n) && n > 0 ? n * dayWidth : 0
}

/** Is `date` within the inclusive range [start, end]? Zero-padded YYYY-MM-DD strings
 *  sort chronologically, so a plain string compare is exact AND avoids three parseISO
 *  calls — and this is the scheduler's hottest path (called per resource × per day ×
 *  per allocation when building day capacity). */
export function isWithin(date: ISODate, start: ISODate, end: ISODate): boolean {
  return date >= start && date <= end
}

/** Today as a date-only ISO string (impure — reads the system clock). */
export function todayISO(): ISODate {
  return toISODate(new Date())
}

/** Is `date`'s weekday one of `workingDays`? */
export function isWorkingWeekday(date: ISODate, workingDays: Weekday[]): boolean {
  return workingDays.includes(weekdayOf(date))
}

/** Should weekend/non-working days be treated specially? True only when the
 *  resource has a PARTIAL working week (1–6 working days) AND the allocation
 *  hasn't opted out via `ignoreWeekends`. This is the single condition shared by
 *  drag math (gestureMath) and the days/hours conversions (schedulingDays) so the
 *  two can never disagree on what "a working day" means. */
export function isWeekendAware(
  workingDays: Weekday[] | undefined,
  ignoreWeekends: boolean | undefined,
): boolean {
  return !ignoreWeekends && !!workingDays && workingDays.length > 0 && workingDays.length < 7
}

/** Count the working days within the inclusive range [start, end], given which
 *  weekdays are working. Returns 0 for a reversed/empty range. */
export function countWorkingDays(start: ISODate, end: ISODate, workingDays: Weekday[]): number {
  const span = daysInclusive(start, end)
  if (span <= 0) return 0
  let count = 0
  for (let i = 0; i < span; i++) {
    if (isWorkingWeekday(addDaysISO(start, i), workingDays)) count++
  }
  return count
}

/** The end date such that [start, end] contains exactly `count` working days —
 *  i.e. `end` lands on the `count`-th working day at/after `start`.
 *
 *  Guards against the degenerate cases that would otherwise loop forever or make
 *  no sense: if `count <= 0`, `workingDays` is empty, or every weekday is a
 *  working day, it falls back to a raw inclusive calendar span. A hard iteration
 *  cap is also kept as a backstop so a bad `workingDays` can never hang. */
export function endDateForWorkingDays(
  start: ISODate,
  count: number,
  workingDays: Weekday[],
): ISODate {
  if (count <= 0 || workingDays.length === 0 || workingDays.length >= 7) {
    return addDaysISO(start, Math.max(0, count - 1))
  }
  const maxScan = count * 7 + 7 // backstop: far more than enough to find `count`
  let found = 0
  for (let i = 0; i < maxScan; i++) {
    const day = addDaysISO(start, i)
    if (isWorkingWeekday(day, workingDays)) {
      found++
      if (found === count) return day
    }
  }
  // Unreachable in practice (count working days always exist within maxScan);
  // return the last scanned day rather than throw.
  return addDaysISO(start, maxScan - 1)
}
