import type { Weekday } from "../types/entities";

const WEEKDAY_COUNT = 7;
const DEFAULT_WORKING_DAY_COUNT = 5;

/** The first five weekdays in a company's configured week, stored as a stable set. */
export function defaultAccountWorkingDays(weekStartsOn: 0 | 1 = 1): Weekday[] {
  return Array.from(
    { length: DEFAULT_WORKING_DAY_COUNT },
    (_, offset) => ((weekStartsOn + offset) % WEEKDAY_COUNT) as Weekday,
  ).sort((a, b) => a - b);
}

/** Repair an account weekday selection at an import or direct-write boundary. Empty is deliberate. */
export function normalizeAccountWorkingDays(value: unknown, weekStartsOn: 0 | 1 = 1): Weekday[] {
  if (!Array.isArray(value) || value.some((day) => !Number.isInteger(day) || day < 0 || day >= WEEKDAY_COUNT)) {
    return defaultAccountWorkingDays(weekStartsOn);
  }
  return [...new Set(value as Weekday[])].sort((a, b) => a - b);
}

/** Weekdays ordered for presentation, beginning with the company's configured week start. */
export function orderedWeekdays(weekStartsOn: 0 | 1 = 1): Weekday[] {
  return Array.from({ length: WEEKDAY_COUNT }, (_, offset) => ((weekStartsOn + offset) % WEEKDAY_COUNT) as Weekday);
}
