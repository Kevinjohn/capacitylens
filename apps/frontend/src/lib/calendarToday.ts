import { resolveCalendarToday } from '@capacitylens/shared/lib/calendarToday';
import type { ISODate } from '@capacitylens/shared/types/entities';

const MAX_INVALID_TIMEZONE_WARNINGS = 32;
const warnedInvalidTimeZones = new Set<string>();
let warnedInvalidTimeZoneLimit = false;

/**
 * Reads the calendar date at an instant in a company's time zone (impure by default: reads the
 * system clock). An absent zone, or an invalid one, gives the local date.
 *
 * An invalid zone leaves a `console.warn` breadcrumb so it is discoverable instead of masked.
 * Distinct zones are warned individually up to a bound, then one aggregate warning records that
 * further values are suppressed.
 */
export function readCalendarToday(timeZone?: string, now: number = Date.now()): ISODate {
  const result = resolveCalendarToday(timeZone, now);
  if (result.kind === 'invalid-time-zone') warnInvalidTimeZone(result.timeZone, result.cause);
  return result.date;
}

function warnInvalidTimeZone(timeZone: string, cause: unknown): void {
  if (
    warnedInvalidTimeZones.has(timeZone) ||
    warnedInvalidTimeZones.size >= MAX_INVALID_TIMEZONE_WARNINGS
  ) {
    return;
  }
  warnedInvalidTimeZones.add(timeZone);
  console.warn(
    `readCalendarToday: invalid timeZone ${JSON.stringify(timeZone)} — falling back to local date`,
    cause,
  );
  if (
    warnedInvalidTimeZones.size === MAX_INVALID_TIMEZONE_WARNINGS &&
    !warnedInvalidTimeZoneLimit
  ) {
    warnedInvalidTimeZoneLimit = true;
    console.warn(
      `readCalendarToday: ${MAX_INVALID_TIMEZONE_WARNINGS} distinct invalid time zones observed; further distinct values will be suppressed`,
    );
  }
}
