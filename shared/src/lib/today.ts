import type { ISODate } from "../types/entities";
import { assertFourDigitISODate, toISODate } from "./isoDate";

const warnedInvalidTimeZones = new Set<string>();
const MAX_INVALID_TIMEZONE_WARNINGS = 32;
let warnedInvalidTimeZoneLimit = false;

// Reuse formatters because construction is expensive on the render path.
// Cache null for invalid zones to avoid repeated constructor failures; diagnostics have a separate bounded warning budget.
const calendarFormatters = new Map<string, Intl.DateTimeFormat | null>();

function createCalendarFormatter(timeZone: string): Intl.DateTimeFormat | null {
  const cached = calendarFormatters.get(timeZone);
  if (cached !== undefined) return cached;
  let formatter: Intl.DateTimeFormat | null;
  try {
    // Use formatToParts for safety (avoids any locale-specific separators). Only the
    // Intl constructor is guarded here. A malformed IANA timeZone is the only thing
    // this try/catch is meant to degrade. The assembly+validation in `todayISO` happens
    // outside it so an out-of-domain year throws RangeError (per module contract) instead
    // of being misreported as an "invalid timeZone" and silently swapped for local date.
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch (e) {
    // A malformed IANA timeZone makes the Intl.DateTimeFormat constructor throw a RangeError,
    // which would otherwise crash "today" resolution and with it the whole forward-window
    // utilisation calc. The client path can still hold an un-sanitised `account.timezone`
    // (sanitizeAccount only runs on the server write path), so degrade to the local date,
    // but warn, never silently, so a bad zone is discoverable instead of masked.
    formatter = null;
    if (!warnedInvalidTimeZones.has(timeZone) && warnedInvalidTimeZones.size < MAX_INVALID_TIMEZONE_WARNINGS) {
      warnedInvalidTimeZones.add(timeZone);
      console.warn(`todayISO: invalid timeZone ${JSON.stringify(timeZone)} — falling back to local date`, e);
      if (warnedInvalidTimeZones.size === MAX_INVALID_TIMEZONE_WARNINGS && !warnedInvalidTimeZoneLimit) {
        warnedInvalidTimeZoneLimit = true;
        console.warn(
          `todayISO: ${MAX_INVALID_TIMEZONE_WARNINGS} distinct invalid time zones observed; further distinct values will be suppressed`,
        );
      }
    }
  }
  calendarFormatters.set(timeZone, formatter);
  return formatter;
}

/** The calendar date at an instant, as a date-only ISO string (impure by default, reads the
 * system clock).
 * When `timeZone` is given, the calendar date is derived in that zone via
 * Intl.DateTimeFormat, so midnight UTC on 2026-06-11 is still 2026-06-10 in
 * America/New_York. Falls back to the local date when `timeZone` is absent or invalid (a
 * malformed IANA identifier). Distinct invalid-timeZone failures are warned individually up
 * to a bounded limit, then one aggregate warning records that further values are suppressed.
 * A resolved calendar date outside the four-digit ISO year domain (e.g. an absurd system
 * clock) still throws RangeError, same as `toISODate`. That's a real upstream bug, not a
 * degrade case.
 *
 * `now` (epoch milliseconds, defaulting to the clock) makes the zone resolution reusable for a
 * non-"now" instant: the calendar-boundary search behind the scheduler's reactive "today"
 * probes future instants through this same one resolver rather than a second copy of it. */
export function todayISO(timeZone?: string, now: number = Date.now()): ISODate {
  if (!timeZone) return toISODate(new Date(now));
  const formatter = createCalendarFormatter(timeZone);
  if (!formatter) return toISODate(new Date(now));
  const parts = formatter.formatToParts(new Date(now));
  const get = (partType: string) => parts.find((part) => part.type === partType)?.value ?? "00";
  // Validate the assembled string the same way `toISODate` validates its Date-based output:
  // Intl gives `year: "numeric"` (not zero-padded/four-digit) parts, so a system clock outside
  // years 1000-9999 would otherwise silently produce a pseudo-ISODate like "999-06-15" or
  // "10000-01-01" that breaks the module's load-bearing lexicographic YYYY-MM-DD compares.
  return assertFourDigitISODate(`${get("year")}-${get("month")}-${get("day")}`);
}
