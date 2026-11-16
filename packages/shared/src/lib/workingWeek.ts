import type { ISODate, Weekday } from '../types/entities.js';
import { addDaysISO, daysInclusive, weekdayOf } from './dateMath.js';

// Working-week policy over the calendar arithmetic in dateMath: which days of a resource's week
// carry work, and how many working days a date range holds.

/** Should weekend/non-working days be treated specially? True only when the
 * resource has a partial working week (1–6 working days) and the allocation
 * hasn't opted out via `ignoreWorkingDays`. This is the single condition shared by
 * drag math (gestureMath) and the days/hours conversions (schedulingDays) so the
 * two can never disagree on what "a working day" means.
 *
 * A seven-bit mask counts distinct valid weekdays without allocating a Set on the capacity hot path.
 * Invalid weekday entries are ignored consistently with the other weekday calculations. */
export function isWeekendAware(
  workingDays: Weekday[] | undefined,
  ignoreWorkingDays: boolean | undefined,
): boolean {
  if (ignoreWorkingDays || !workingDays) return false;
  let mask = 0;
  for (const day of workingDays) {
    if (day >= 0 && day <= 6) mask |= 1 << day;
  }
  return mask !== 0 && mask !== 0b1111111;
}

/** Does an allocation place work on a given day? A weekend-aware allocation works only the resource's
 * working weekdays (a bar that merely spans a non-working day does no work there), while an
 * allocation that opts into weekends (`ignoreWorkingDays`), or a resource with a full/empty working
 * week, works every calendar day. The single per-day companion to `isWeekendAware`, shared by the
 * over-marker (`allocatedHoursOnDay`) and its advisory mirror (`capacityAdvisory`) so the two can't
 * disagree on which days an allocation works. `dayIsWorkingWeekday` tells whether the date's
 * weekday belongs to the working week, passed in so the caller derives it once per day, not once per allocation. */
export function allocationWorksOnDay(
  workingDays: Weekday[] | undefined,
  ignoreWorkingDays: boolean | undefined,
  dayIsWorkingWeekday: boolean,
): boolean {
  return !isWeekendAware(workingDays, ignoreWorkingDays) || dayIsWorkingWeekday;
}

/** Count the working days within the inclusive range [start, end], given which
 * weekdays are working. Returns 0 for a reversed/empty range. */
export function countWorkingDays(start: ISODate, end: ISODate, workingDays: Weekday[]): number {
  const span = daysInclusive(start, end);
  if (span <= 0) return 0;
  const working = new Set(
    workingDays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
  );
  const fullWeeks = Math.floor(span / 7);
  let count = fullWeeks * working.size;
  const startWeekday = weekdayOf(start);
  for (let offset = 0; offset < span % 7; offset += 1) {
    if (working.has(((startWeekday + offset) % 7) as Weekday)) count += 1;
  }
  return count;
}

/** The end date such that [start, end] contains exactly `count` working days,
 * i.e. `end` lands on the `count`-th working day at/after `start`.
 *
 * `count` must be a safe integer; fractional and non-finite counts are rejected.
 * Guards against the remaining degenerate cases that would otherwise make no sense: if
 * `count <= 0`, the distinct working-day set is empty, or it contains all seven weekdays
 * (treated as a full/every-calendar-day week, matching isWeekendAware), it falls back to a raw
 * inclusive calendar span.
 *
 * Closed-form (O(1)), not a day-by-day scan: the drag-resize gesture math calls this
 * per pointer move, and an absurd input (1-working-day week × ~100-year span) would
 * otherwise spin ~255k iterations. Any 7 consecutive calendar days contain exactly `d`
 * working days (each weekday appears once per week), so the working-day offsets repeat
 * with period 7: offset(k + d) === offset(k) + 7. The count-th working day is therefore
 * `fullWeeks` whole weeks past `start` plus the offset of the `remaining`-th working day
 * within a single week window (a <= 7-step resolve, itself O(1)). Counting distinct
 * weekdays keeps a degenerate array like [1,1,1] (length 3, but only Mondays) correct. */
export function endDateForWorkingDays(
  start: ISODate,
  count: number,
  workingDays: Weekday[],
): ISODate {
  if (!Number.isSafeInteger(count)) throw new RangeError('count must be a safe integer.');
  if (workingDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new RangeError('workingDays must contain only integer weekdays from 0 through 6.');
  }
  const working = new Set(workingDays);
  if (count <= 0 || working.size === 0 || working.size >= 7) {
    return addDaysISO(start, Math.max(0, count - 1));
  }
  // This branch runs only with between one and six distinct weekdays.
  const workingDayCount = working.size;
  const startWd = weekdayOf(start);
  const fullWeeks = Math.floor((count - 1) / workingDayCount);
  // The remainder is at most one working week and is found by the loop below.
  const remaining = count - fullWeeks * workingDayCount;
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
  if (seen !== remaining) throw new Error('The working-day span could not be resolved.');
  return addDaysISO(start, fullWeeks * 7 + offsetInWeek);
}
