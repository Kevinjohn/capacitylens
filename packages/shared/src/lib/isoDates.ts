import type { ISODate } from '../types/entities.js';

/**
 * Length of a Gregorian calendar month, leap years included. `month` is 1-based and must already
 * be 1–12 (callers range-check first, see `isValidISODate` below and repeatingDates' typed
 * wrapper). Exported so the calendar-validity check here and repeatingDates' month arithmetic
 * share one leap rule; two copies could drift on a century year (1900 vs 2000).
 * @throws RangeError when month is not an integer from 1 through 12; callers must range-check it first.
 */
export function daysInMonth(year: number, month: number): number {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (days === undefined) throw new RangeError('Month must be between 1 and 12.');
  return days;
}

/**
 * Is `s` a well-formed, real calendar date in date-only ISO form ("YYYY-MM-DD")?
 * The shape regex alone would accept `2026-13-40` or `2026-02-30` (lexicographic
 * order is fine, but the date is nonsense and breaks later formatting/geometry),
 * so Gregorian month-length arithmetic validates it without consulting the host timezone.
 */
export function isValidISODate(value: unknown): value is ISODate {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

const ISO_TIMESTAMP_RE =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;

interface TimestampOffsetParts {
  zone: string | undefined;
  sign: string | undefined;
  offsetHourText: string | undefined;
  offsetMinuteText: string | undefined;
}

function timestampOffsetMinutes({
  zone,
  sign,
  offsetHourText,
  offsetMinuteText,
}: TimestampOffsetParts): number | null {
  if (zone === undefined) return null;
  if (zone === 'Z') return 0;
  const offsetHour = Number(offsetHourText);
  const offsetMinute = Number(offsetMinuteText);
  if (offsetHour > 23 || offsetMinute > 59) return null;
  return (sign === '-' ? -1 : 1) * (offsetHour * 60 + offsetMinute);
}

/**
 * Parse the supported ISO timestamp form without accepting implementation-defined Date.parse
 * shorthand or calendar rollover. UTC and explicit numeric offsets are accepted; seconds are
 * required and fractional precision is capped at the millisecond precision the product stores.
 */
export function parseISOTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = ISO_TIMESTAMP_RE.exec(value);
  if (!match) return null;
  const [
    ,
    date,
    hourText,
    minuteText,
    secondText,
    fraction,
    zone,
    sign,
    offsetHourText,
    offsetMinuteText,
  ] = match;
  if (!isValidISODate(date)) return null;

  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const milliseconds = Number((fraction ?? '').padEnd(3, '0') || '0');
  if (hour > 23 || minute > 59 || second > 59) return null;

  const offsetMinutes = timestampOffsetMinutes({ zone, sign, offsetHourText, offsetMinuteText });
  if (offsetMinutes === null) return null;

  const localAsUtc = Date.parse(
    `${date}T${hourText}:${minuteText}:${secondText}.${String(milliseconds).padStart(3, '0')}Z`,
  );
  const expected = localAsUtc - offsetMinutes * 60_000;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed === expected ? parsed : null;
}
