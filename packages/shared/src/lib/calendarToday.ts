import type { ISODate } from '../types/entities.js';
import { assertFourDigitISODate, toISODate } from './dateMath.js';

/**
 * The calendar date at an instant. `invalid-time-zone` means the zone is not a valid IANA
 * identifier and `date` is the local date instead; the caller decides how to report it.
 */
export type CalendarTodayResult =
  | { kind: 'resolved'; date: ISODate }
  | { kind: 'invalid-time-zone'; date: ISODate; timeZone: string; cause: unknown };

type CalendarFormatter =
  { kind: 'valid'; formatter: Intl.DateTimeFormat } | { kind: 'invalid'; cause: unknown };

// Reuse formatters because construction is expensive on the render path. Invalid zones are cached
// with their cause so a repeated lookup neither reconstructs nor loses the reason.
const calendarFormatters = new Map<string, CalendarFormatter>();

function createCalendarFormatter(timeZone: string): CalendarFormatter {
  const cached = calendarFormatters.get(timeZone);
  if (cached !== undefined) return cached;
  let entry: CalendarFormatter;
  try {
    // Use formatToParts for safety (avoids any locale-specific separators). Only the
    // Intl constructor is guarded here. A malformed IANA timeZone is the only thing
    // this try/catch is meant to degrade. The assembly and validation in
    // `resolveCalendarToday` happen outside it so an out-of-domain year throws RangeError
    // instead of being misreported as an invalid zone and swapped for the local date.
    entry = {
      kind: 'valid',
      formatter: new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }),
    };
  } catch (cause) {
    // A malformed IANA timeZone makes the constructor throw a RangeError, which would otherwise
    // crash "today" resolution. The caller receives the cause and the local-date fallback.
    entry = { kind: 'invalid', cause };
  }
  calendarFormatters.set(timeZone, entry);
  return entry;
}

/**
 * Resolves the calendar date at an instant (impure by default: reads the system clock).
 *
 * When a nonempty `timeZone` is given, the date is derived in that zone, so midnight UTC on
 * 2026-06-11 is still 2026-06-10 in America/New_York. An absent or empty zone selects the local
 * date. An invalid nonempty IANA identifier also yields the local date, as an
 * `invalid-time-zone` result carrying the cause. `now` (epoch milliseconds) lets the scheduler's
 * reactive "today" probe future instants through this same resolver.
 *
 * @throws `RangeError` when the resolved date falls outside the four-digit ISO year domain, as
 *   `toISODate` does; that is an upstream bug, not a fallback case.
 */
export function resolveCalendarToday(
  timeZone?: string,
  now: number = Date.now(),
): CalendarTodayResult {
  if (!timeZone) return { kind: 'resolved', date: toISODate(new Date(now)) };
  const entry = createCalendarFormatter(timeZone);
  if (entry.kind === 'invalid') {
    return {
      kind: 'invalid-time-zone',
      date: toISODate(new Date(now)),
      timeZone,
      cause: entry.cause,
    };
  }
  const parts = entry.formatter.formatToParts(new Date(now));
  const get = (partType: string) => parts.find((part) => part.type === partType)?.value ?? '00';
  // Intl gives `year: "numeric"` parts, so a system clock outside years 1000-9999 would otherwise
  // produce a pseudo-ISODate like "999-06-15" that breaks lexicographic YYYY-MM-DD compares.
  return {
    kind: 'resolved',
    date: assertFourDigitISODate(`${get('year')}-${get('month')}-${get('day')}`),
  };
}
