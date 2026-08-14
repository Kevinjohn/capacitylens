import { addDays, differenceInCalendarDays, format, parseISO, startOfWeek } from "date-fns";
import type { ISODate, Weekday } from "../types/entities";

/** Defensive allocation ceiling for materialised date arrays (~100 calendar years).
 *  Re-exported as `MAX_SPAN_DAYS` (schedulingDays) — ONE number, two names. */
export const MAX_MATERIALISED_DAYS = 36_500;

/** Last date in the four-digit ISO year domain this module owns (see `assertFourDigitISODate`).
 *  Every span/repeat ceiling clamps against THIS constant so the scheduling and repeat paths can
 *  never disagree on where the calendar ends. */
export const MAX_ISO_DATE = "9999-12-31" as ISODate;

// All scheduler geometry is done in INTEGER day-indices derived from date-only
// ISO strings. We never do millisecond Date math for positioning — that is the
// classic DST / timezone off-by-one bug. date-fns' calendar-day helpers are
// timezone-agnostic for our purposes.
//
// PRECONDITION (load-bearing): every `ISODate` argument MUST be a validated,
// zero-padded "YYYY-MM-DD" string. These helpers are PURE and deliberately do NOT
// re-validate — `validateDateRange` (lib/integrity.ts, via `isValidISODate`) enforces
// it at every write boundary (store add/update, import remap, server validate), and
// import normalises dates on the way in. Pass an invalid/unpadded string and `parseISO`
// returns an Invalid Date whose downstream `format()` throws a RangeError. Extended-year input
// can parse, but `toISODate` rejects any output outside the four-digit product domain. Do NOT
// "harden" that by wrapping these in try/catch: it would swallow a real upstream bug in
// the hottest path. The guarantee lives at the boundary, by design.

/**
 * Parse a validated date-only ISO string ("YYYY-MM-DD") to a local Date at midnight.
 *
 * @param date a validated `ISODate` (see the module precondition above). An invalid or
 *   unpadded string parses to an **Invalid Date**, which makes a later `format()`/`toISODate`
 *   throw a RangeError — surface that as the upstream-validation bug it is, don't catch it here.
 */
export function parseDate(date: ISODate): Date {
  return parseISO(date);
}

/** Shared four-digit-year, zero-padded "YYYY-MM-DD" shape check, reused by every
 *  assembly path (Date-based `toISODate` AND the Intl.DateTimeFormat-parts path in
 *  `todayISO`'s timezone branch) so an out-of-domain year always throws the same
 *  RangeError instead of one path silently emitting a pseudo-ISODate. */
function assertFourDigitISODate(candidate: string): ISODate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    throw new RangeError("Date falls outside the supported four-digit ISO year range.");
  }
  return candidate as ISODate;
}

/** Format a Date back to a date-only ISO string within the four-digit product year domain. */
export function toISODate(date: Date): ISODate {
  return assertFourDigitISODate(format(date, "yyyy-MM-dd"));
}

/** Whole-calendar-day offset of `date` from `origin` (may be negative).
 *  Both args must be validated `ISODate`s (see the module precondition); an invalid one
 *  yields `NaN` here, which the geometry callers (columnGeometry's `xForDateInGeom` /
 *  `widthForDates`) `Number.isFinite`-guard to 0. */
export function dayIndex(date: ISODate, origin: ISODate): number {
  return differenceInCalendarDays(parseISO(date), parseISO(origin));
}

/** Add (or subtract, with a negative `days`) whole days to a date-only ISO string.
 *  `date` must be a validated `ISODate` (see the module precondition) — an invalid one
 *  produces an Invalid Date and the inner `toISODate`/`format()` throws RangeError. */
export function addDaysISO(date: ISODate, days: number): ISODate {
  return toISODate(addDays(parseISO(date), days));
}

/** Inclusive day count of [start, end]: end - start + 1. Can be <= 0 if reversed. */
export function daysInclusive(start: ISODate, end: ISODate): number {
  return differenceInCalendarDays(parseISO(end), parseISO(start)) + 1;
}

/** Every date-only ISO string in [start, end], inclusive. Empty when end < start. */
export function eachDayISO(start: ISODate, end: ISODate): ISODate[] {
  const count = daysInclusive(start, end);
  if (count <= 0) return [];
  if (count > MAX_MATERIALISED_DAYS) {
    throw new RangeError(`Date range exceeds the ${MAX_MATERIALISED_DAYS}-day materialisation limit.`);
  }
  const out: ISODate[] = [];
  // Parse `start` ONCE and step the resulting Date with addDays, formatting each day once. The
  // previous `addDaysISO(start, i)` per iteration re-parsed the start STRING every time (~n+1
  // parses + n formats for an n-day range) — this is a hot path (per-resource capacity windows),
  // so that redundant re-parsing shows up directly as scroll/zoom jank on large teams.
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
 *  `weekStartsOn`: 0 = Sunday, 1 = Monday (default, ISO-style). */
export function startOfWeekISO(date: ISODate, weekStartsOn: 0 | 1 = 1): ISODate {
  return toISODate(startOfWeek(parseISO(date), { weekStartsOn }));
}

/** Is `date` within the inclusive range [start, end]? Zero-padded YYYY-MM-DD strings
 *  sort chronologically, so a plain string compare is exact AND avoids three parseISO
 *  calls — and this is the scheduler's hottest path (called per resource × per day ×
 *  per allocation when building day capacity). The zero-padding assumption is not just
 *  convention: `validateDateRange` (integrity.ts) rejects any non-`YYYY-MM-DD` date at
 *  EVERY write boundary (store add/update, import remap, server validate), so an
 *  unpadded date like "2026-6-1" can never reach this comparison. */
export function isWithin(date: ISODate, start: ISODate, end: ISODate): boolean {
  return date >= start && date <= end;
}

/** Do the two INCLUSIVE ranges [aStart, aEnd] and [bStart, bEnd] share at least one day?
 *  Both ends are closed on both sides — a range that merely touches the other's edge
 *  overlaps — which is what every caller (timeline intersection, keyboard-nudge visibility)
 *  means by "still on screen". Same zero-padded lexicographic compare as `isWithin`, for the
 *  same reason: exact, and no parseISO on a hot path. */
export function rangesOverlap(aStart: ISODate, aEnd: ISODate, bStart: ISODate, bEnd: ISODate): boolean {
  return aEnd >= bStart && aStart <= bEnd;
}

const warnedInvalidTimeZones = new Set<string>();
const MAX_INVALID_TIMEZONE_WARNINGS = 32;
let warnedInvalidTimeZoneLimit = false;

/** One Intl.DateTimeFormat per zone: constructing a formatter is the expensive part, and
 *  `todayISO` is called on every grid render (plus once per step of the calendar-boundary binary
 *  search in useCalendarToday). `null` marks a zone whose constructor threw, so a bad stored zone
 *  is diagnosed once instead of re-thrown on every call. Bounded in practice — the key is an
 *  account's stored IANA zone, drawn from the ICU zone database. */
const calendarFormatters = new Map<string, Intl.DateTimeFormat | null>();

function calendarFormatter(timeZone: string): Intl.DateTimeFormat | null {
  const cached = calendarFormatters.get(timeZone);
  if (cached !== undefined) return cached;
  let formatter: Intl.DateTimeFormat | null;
  try {
    // Use formatToParts for safety (avoids any locale-specific separators). Only the
    // Intl constructor is guarded here — a malformed IANA timeZone is the ONLY thing
    // this try/catch is meant to degrade. The assembly+validation in `todayISO` happens
    // OUTSIDE it so an out-of-domain year throws RangeError (per module contract) instead
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
    // (sanitizeAccount only runs on the server write path), so degrade to the LOCAL date —
    // but WARN, never silently, so a bad zone is discoverable instead of masked.
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

/** The calendar date at an instant, as a date-only ISO string (impure by default — reads the
 *  system clock).
 *  When `timeZone` is given, the calendar date is derived in that zone via
 *  Intl.DateTimeFormat — so midnight UTC on 2026-06-11 is still 2026-06-10 in
 *  America/New_York. Falls back to the LOCAL date when `timeZone` is absent OR invalid (a
 *  malformed IANA identifier). Distinct invalid-timeZone failures are warned individually up
 *  to a bounded limit, then one aggregate warning records that further values are suppressed.
 *  A resolved calendar date outside the four-digit ISO year domain (e.g. an absurd system
 *  clock) still throws RangeError, same as `toISODate` — that's a real upstream bug, not a
 *  degrade case.
 *
 *  `now` (epoch milliseconds, defaulting to the clock) makes the zone resolution reusable for a
 *  NON-"now" instant — the calendar-boundary search behind the scheduler's reactive "today"
 *  probes future instants through this same one resolver rather than a second copy of it. */
export function todayISO(timeZone?: string, now: number = Date.now()): ISODate {
  if (!timeZone) return toISODate(new Date(now));
  const formatter = calendarFormatter(timeZone);
  if (!formatter) return toISODate(new Date(now));
  const parts = formatter.formatToParts(new Date(now));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  // Validate the assembled string the same way `toISODate` validates its Date-based output:
  // Intl gives `year: "numeric"` (NOT zero-padded/four-digit) parts, so a system clock outside
  // years 1000-9999 would otherwise silently produce a pseudo-ISODate like "999-06-15" or
  // "10000-01-01" that breaks the module's load-bearing lexicographic YYYY-MM-DD compares.
  return assertFourDigitISODate(`${get("year")}-${get("month")}-${get("day")}`);
}

/** Is `date`'s weekday one of `workingDays`? */
export function isWorkingWeekday(date: ISODate, workingDays: Weekday[]): boolean {
  return workingDays.includes(weekdayOf(date));
}

/** Should weekend/non-working days be treated specially? True only when the
 *  resource has a PARTIAL working week (1–6 working days) AND the allocation
 *  hasn't opted out via `ignoreWeekends`. This is the single condition shared by
 *  drag math (gestureMath) and the days/hours conversions (schedulingDays) so the
 *  two can never disagree on what "a working day" means.
 *
 *  Distinctness is tracked in a 7-bit mask rather than a `Set`: this runs per resource × per day ×
 *  per allocation when building day capacity (~200k calls in one capacity pass), and the throwaway
 *  Set per call dominated the cost. Only weekdays 0–6 set a bit — the `Weekday` type plus import
 *  sanitisation (`safeWorkingDays`) already make an out-of-range entry unreachable, and ignoring it
 *  is the answer that matches the rest of the weekday math. */
export function isWeekendAware(workingDays: Weekday[] | undefined, ignoreWeekends: boolean | undefined): boolean {
  if (ignoreWeekends || !workingDays) return false;
  let mask = 0;
  for (const day of workingDays) {
    if (day >= 0 && day <= 6) mask |= 1 << day;
  }
  return mask !== 0 && mask !== 0b1111111;
}

/** Does an allocation place work on a given day? A weekend-aware allocation works ONLY the resource's
 *  working weekdays — a bar that merely SPANS a non-working day does no work there — while an
 *  allocation that opts into weekends (`ignoreWeekends`), or a resource with a full/empty working
 *  week, works every calendar day. The single per-day companion to `isWeekendAware`, shared by the
 *  over-marker (`allocatedHoursOnDay`) and its advisory mirror (`capacityAdvisory`) so the two can't
 *  disagree on which days an allocation works. `dayIsWorkingWeekday` is `isWorkingWeekday(date,
 *  workingDays)`, passed in so the caller derives the weekday ONCE per day, not once per allocation. */
export function allocationWorksOnDay(
  workingDays: Weekday[] | undefined,
  ignoreWeekends: boolean | undefined,
  dayIsWorkingWeekday: boolean,
): boolean {
  return !isWeekendAware(workingDays, ignoreWeekends) || dayIsWorkingWeekday;
}

/** Count the working days within the inclusive range [start, end], given which
 *  weekdays are working. Returns 0 for a reversed/empty range. */
export function countWorkingDays(start: ISODate, end: ISODate, workingDays: Weekday[]): number {
  const span = daysInclusive(start, end);
  if (span <= 0) return 0;
  const working = new Set(workingDays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6));
  const fullWeeks = Math.floor(span / 7);
  let count = fullWeeks * working.size;
  const startWeekday = weekdayOf(start);
  for (let offset = 0; offset < span % 7; offset += 1) {
    if (working.has(((startWeekday + offset) % 7) as Weekday)) count += 1;
  }
  return count;
}

/** The end date such that [start, end] contains exactly `count` working days —
 *  i.e. `end` lands on the `count`-th working day at/after `start`.
 *
 *  `count` must be a safe integer; fractional and non-finite counts are rejected.
 *  Guards against the remaining degenerate cases that would otherwise make no sense: if
 *  `count <= 0`, the distinct working-day set is empty, or it contains all seven weekdays
 *  (treated as a full/every-calendar-day week, matching isWeekendAware), it falls back to a raw
 *  inclusive calendar span.
 *
 *  Closed-form (O(1)), not a day-by-day scan — the drag-resize gesture math calls this
 *  per pointer move, and an absurd input (1-working-day week × ~100-year span) would
 *  otherwise spin ~255k iterations. Any 7 consecutive calendar days contain exactly `d`
 *  working days (each weekday appears once per week), so the working-day offsets repeat
 *  with period 7: offset(k + d) === offset(k) + 7. The count-th working day is therefore
 *  `fullWeeks` whole weeks past `start` plus the offset of the `remaining`-th working day
 *  within a single week window (a <= 7-step resolve, itself O(1)). Counting DISTINCT
 *  weekdays keeps a degenerate array like [1,1,1] (length 3, but only Mondays) correct. */
export function endDateForWorkingDays(start: ISODate, count: number, workingDays: Weekday[]): ISODate {
  if (!Number.isSafeInteger(count)) throw new RangeError("count must be a safe integer.");
  if (workingDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new RangeError("workingDays must contain only integer weekdays from 0 through 6.");
  }
  const working = new Set(workingDays);
  if (count <= 0 || working.size === 0 || working.size >= 7) {
    return addDaysISO(start, Math.max(0, count - 1));
  }
  const d = working.size; // distinct working weekdays, 1..6 in this branch
  const startWd = weekdayOf(start);
  const fullWeeks = Math.floor((count - 1) / d);
  const remaining = count - fullWeeks * d; // 1..d — always found within the week below
  let seen = 0;
  let offsetInWeek = 0;
  for (let j = 0; j < 7; j++) {
    if (working.has(((startWd + j) % 7) as Weekday)) {
      seen++;
      if (seen === remaining) {
        offsetInWeek = j;
        break;
      }
    }
  }
  if (seen !== remaining) throw new Error("The working-day span could not be resolved.");
  return addDaysISO(start, fullWeeks * 7 + offsetInWeek);
}
