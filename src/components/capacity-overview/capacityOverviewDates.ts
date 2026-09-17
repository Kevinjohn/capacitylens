import { addDaysISO, startOfWeekISO } from "@capacitylens/shared/lib/dateMath";
import type { ISODate } from "@capacitylens/shared/types/entities";

export type CapacityOverviewHorizon = "4-weeks" | "8-weeks" | "12-weeks";

/** The first four keys are stable for callers that persisted or keyed by them. */
export type CapacityOverviewPeriodKey = "this-week" | "next-week" | `week-${number}`;

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

const HORIZON_WEEKS: Record<CapacityOverviewHorizon, number> = {
  "4-weeks": 4,
  "8-weeks": 8,
  "12-weeks": 12,
};

/** Number of week columns a horizon displays. */
export function horizonWeekCount(horizon: CapacityOverviewHorizon): number {
  return HORIZON_WEEKS[horizon];
}

function periodKey(index: number): CapacityOverviewPeriodKey {
  if (index === 0) return "this-week";
  if (index === 1) return "next-week";
  return `week-${index + 1}`;
}

/** Build the remainder of the current workspace week followed by complete weeks up to the horizon. */
export function buildCapacityOverviewPeriods({
  today,
  weekStartsOn = 1,
  horizon = "4-weeks",
}: BuildCapacityOverviewPeriodsInput): CapacityOverviewPeriod[] {
  const currentWeekStart = startOfWeekISO(today, weekStartsOn);
  const currentWeekEnd = addDaysISO(currentWeekStart, 6);
  return Array.from({ length: horizonWeekCount(horizon) }, (_unused, index) => {
    const start = index === 0 ? today : addDaysISO(currentWeekEnd, 1 + (index - 1) * 7);
    const end = index === 0 ? currentWeekEnd : addDaysISO(start, 6);
    return { index, key: periodKey(index), start, end, partial: index === 0 };
  });
}
