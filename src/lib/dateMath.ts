import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns'
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

/** Pixel x-offset of a date's left edge from the timeline origin. */
export function xForDate(date: ISODate, origin: ISODate, dayWidth: number): number {
  return dayIndex(date, origin) * dayWidth
}

/** Pixel width of an inclusive [start, end] range. */
export function widthForRange(start: ISODate, end: ISODate, dayWidth: number): number {
  return daysInclusive(start, end) * dayWidth
}

/** Is `date` within the inclusive range [start, end]? */
export function isWithin(date: ISODate, start: ISODate, end: ISODate): boolean {
  const d = parseISO(date)
  return d >= parseISO(start) && d <= parseISO(end)
}

/** Today as a date-only ISO string (impure — reads the system clock). */
export function todayISO(): ISODate {
  return toISODate(new Date())
}
