import { addDaysISO, startOfWeekISO } from '@capacitylens/shared/lib/dateMath';
import { CAPACITY_OVERVIEW_HORIZON_WEEKS } from '@capacitylens/shared/lib/planningWindows';
import type { CapacityOverviewHorizon } from '@capacitylens/shared/lib/planningWindows';
import type { ISODate } from '@capacitylens/shared/types/entities';

export type { CapacityOverviewHorizon };

/** Stable period identifiers name the current and next weeks, then use the week index for subsequent periods. */
export type CapacityOverviewPeriodKey = 'this-week' | 'next-week' | `week-${number}`;

/** A dated overview period with its stable index and label. */
export interface CapacityOverviewPeriod {
  index: number;
  key: CapacityOverviewPeriodKey;
  start: ISODate;
  end: ISODate;
  /** The first column starts today; the remaining columns are complete company weeks. */
  partial: boolean;
}

/** Today, horizon, and calendar preferences needed to generate overview periods. */
export interface BuildCapacityOverviewPeriodsInput {
  today: ISODate;
  weekStartsOn?: 0 | 1;
  horizon?: CapacityOverviewHorizon;
}

/** Number of week columns a horizon displays. */
export function resolveHorizonWeekCount(horizon: CapacityOverviewHorizon): number {
  return CAPACITY_OVERVIEW_HORIZON_WEEKS[horizon];
}

function buildPeriodKey(index: number): CapacityOverviewPeriodKey {
  if (index === 0) return 'this-week';
  if (index === 1) return 'next-week';
  return `week-${index + 1}`;
}

/** Build the remainder of the current company week followed by complete weeks up to the horizon. */
export function buildCapacityOverviewPeriods({
  today,
  weekStartsOn = 1,
  horizon = '4-weeks',
}: BuildCapacityOverviewPeriodsInput): CapacityOverviewPeriod[] {
  const currentWeekStart = startOfWeekISO(today, weekStartsOn);
  const currentWeekEnd = addDaysISO(currentWeekStart, 6);
  return Array.from({ length: resolveHorizonWeekCount(horizon) }, (_unused, index) => {
    const start = index === 0 ? today : addDaysISO(currentWeekEnd, 1 + (index - 1) * 7);
    const end = index === 0 ? currentWeekEnd : addDaysISO(start, 6);
    return { index, key: buildPeriodKey(index), start, end, partial: index === 0 };
  });
}
