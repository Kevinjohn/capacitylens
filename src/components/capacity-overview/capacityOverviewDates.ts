import { addDaysISO, startOfWeekISO } from "@capacitylens/shared/lib/dateMath";
import type { ISODate } from "@capacitylens/shared/types/entities";

export type CapacityOverviewWeekKey = "this-week" | "next-week" | "week-3" | "week-4";

export interface CapacityOverviewWeek {
  index: number;
  key: CapacityOverviewWeekKey;
  start: ISODate;
  end: ISODate;
  /** The first column starts today; the remaining columns are complete workspace weeks. */
  partial: boolean;
}

export interface BuildCapacityOverviewWeeksInput {
  today: ISODate;
  weekStartsOn?: 0 | 1;
}

/** Build the fixed four-column planning window from the account's calendar week. */
export function buildCapacityOverviewWeeks({
  today,
  weekStartsOn = 1,
}: BuildCapacityOverviewWeeksInput): CapacityOverviewWeek[] {
  const currentWeekStart = startOfWeekISO(today, weekStartsOn);
  const currentWeekEnd = addDaysISO(currentWeekStart, 6);
  const keys: CapacityOverviewWeekKey[] = ["this-week", "next-week", "week-3", "week-4"];
  return keys.map((key, index) => {
    const start = index === 0 ? today : addDaysISO(currentWeekEnd, 1 + (index - 1) * 7);
    const end = index === 0 ? currentWeekEnd : addDaysISO(start, 6);
    return { index, key, start, end, partial: index === 0 };
  });
}
