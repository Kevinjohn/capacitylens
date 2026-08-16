import type { Weekday } from "../types/entities";

const WEEKDAY_COUNT = 7;
const DEFAULT_WORKING_DAY_COUNT = 5;

/** True for a whole-number weekday index inside the seven-day week. The ONE shape test every
 *  weekday guard (store asserts, form validation, import repair) reads, so none can drift. */
export const isWeekday = (value: unknown): value is Weekday =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) < WEEKDAY_COUNT;

/** True for an array of DISTINCT weekdays. Emptiness is deliberately NOT judged here: an empty
 *  company selection is legal while an empty resource week is not, so each caller keeps that policy. */
export const isWeekdaySet = (days: unknown): days is Weekday[] =>
  Array.isArray(days) && new Set(days).size === days.length && days.every(isWeekday);

/** The first five weekdays in a company's configured week, stored as a stable set.
 *  Both legal week starts (Sunday and Monday) run 0–4 / 1–5, i.e. already ascending, so taking the
 *  presentation order's first five IS the stored set — no re-sort needed. */
export function defaultAccountWorkingDays(weekStartsOn: 0 | 1 = 1): Weekday[] {
  return orderedWeekdays(weekStartsOn).slice(0, DEFAULT_WORKING_DAY_COUNT);
}

/** The stored canonical form for every weekday set: distinct values, ascending. */
export function canonicalWeekdaySet(days: readonly Weekday[]): Weekday[] {
  return [...new Set(days)].sort((a, b) => a - b);
}

/** Repair an account weekday selection at an import or direct-write boundary. Empty is deliberate. */
export function normalizeAccountWorkingDays(value: unknown, weekStartsOn: 0 | 1 = 1): Weekday[] {
  if (!Array.isArray(value) || !value.every(isWeekday)) {
    return defaultAccountWorkingDays(weekStartsOn);
  }
  return canonicalWeekdaySet(value as Weekday[]);
}

/** Weekdays ordered for presentation, beginning with the company's configured week start. */
export function orderedWeekdays(weekStartsOn: 0 | 1 = 1): Weekday[] {
  return Array.from({ length: WEEKDAY_COUNT }, (_, offset) => ((weekStartsOn + offset) % WEEKDAY_COUNT) as Weekday);
}
