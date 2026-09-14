import { addDaysISO, startOfWeekISO } from "@capacitylens/shared/lib/dateMath";
import type { ISODate } from "@capacitylens/shared/types/entities";

export type CapacityOverviewHorizon = "4-weeks" | "12-weeks";

/** Keys for the four tactical slots are stable for callers that persisted or keyed by them. */
export type CapacityOverviewPeriodKey = "this-week" | "next-week" | "week-3" | "week-4" | "weeks-5-8" | "weeks-9-12";

export interface CapacityOverviewPeriod {
  index: number;
  key: CapacityOverviewPeriodKey;
  start: ISODate;
  end: ISODate;
  /** The first column starts today; the remaining columns are complete workspace weeks. */
  partial: boolean;
}

export interface BuildCapacityOverviewPeriodsInput {
  today: ISODate;
  weekStartsOn?: 0 | 1;
  horizon?: CapacityOverviewHorizon;
}

function periodStart(index: number, today: ISODate, currentWeekEnd: ISODate): ISODate {
  if (index === 0) return today;
  if (index < 4) return addDaysISO(currentWeekEnd, 1 + (index - 1) * 7);
  return addDaysISO(currentWeekEnd, 22 + (index - 4) * 28);
}

function periodEnd(index: number, start: ISODate, currentWeekEnd: ISODate): ISODate {
  if (index === 0) return currentWeekEnd;
  if (index < 4) return addDaysISO(start, 6);
  return addDaysISO(start, 27);
}

/** Build the tactical window, optionally followed by two complete four-week periods. */
export function buildCapacityOverviewPeriods({
  today,
  weekStartsOn = 1,
  horizon = "4-weeks",
}: BuildCapacityOverviewPeriodsInput): CapacityOverviewPeriod[] {
  const currentWeekStart = startOfWeekISO(today, weekStartsOn);
  const currentWeekEnd = addDaysISO(currentWeekStart, 6);
  const keys: CapacityOverviewPeriodKey[] =
    horizon === "12-weeks"
      ? ["this-week", "next-week", "week-3", "week-4", "weeks-5-8", "weeks-9-12"]
      : ["this-week", "next-week", "week-3", "week-4"];

  return keys.map((key, index) => {
    const start = periodStart(index, today, currentWeekEnd);
    const end = periodEnd(index, start, currentWeekEnd);
    return { index, key, start, end, partial: index === 0 };
  });
}

export interface BuildCapacityOverviewWeeksInput {
  today: ISODate;
  weekStartsOn?: 0 | 1;
}

/** Build the fixed four-column planning window from the account's calendar week. */
export function buildCapacityOverviewWeeks({
  today,
  weekStartsOn = 1,
}: BuildCapacityOverviewWeeksInput): CapacityOverviewPeriod[] {
  return buildCapacityOverviewPeriods({ today, weekStartsOn });
}
