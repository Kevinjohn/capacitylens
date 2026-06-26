import { format } from 'date-fns'
import { daysInclusive, parseDate } from '@capacitylens/shared/lib/dateMath'
import type { ISODate } from '@capacitylens/shared/types/entities'
import { m } from '@/i18n'

// Human-readable date presentation for at-a-glance lists (e.g. the Time-off list), where a
// reader wants "which days, how long" — not a machine date. Pure display formatting only; the
// scheduler's geometry still works in integer day-indices (shared/lib/dateMath), never these
// strings. `date` arguments are validated `ISODate`s by the time they reach a render — an invalid
// one makes date-fns `format` throw a RangeError, which we deliberately let surface as the
// upstream-validation bug it is (see dateMath's module precondition) rather than wrap-and-swallow.

/**
 * A terse, scannable date: "Wed 10th Jun".
 *
 * Abbreviated weekday + ordinal day + abbreviated month, deliberately **no year** — these read
 * inside a list where the year is unambiguous from context. Short enough that a row reads at a
 * glance ("who · when · how long") instead of as a sentence; the full span isn't shown here (the
 * day count carries "how long"), so this formats a single anchor date — typically the start.
 */
export function formatShortDate(date: ISODate): string {
  return format(parseDate(date), 'EEE do MMM')
}

/**
 * The inclusive day count as a label: "1 day" / "5 days".
 *
 * Clamped at 0 so a reversed/empty range degrades to "0 days" rather than a negative count — the
 * write boundary (`validateDateRange`) already rejects reversed ranges, so this is purely
 * belt-and-braces for the display path.
 */
export function formatDayCount(start: ISODate, end: ISODate): string {
  const n = Math.max(0, daysInclusive(start, end))
  return n === 1 ? m.list_timeoff_days_one({ count: n }) : m.list_timeoff_days_other({ count: n })
}
