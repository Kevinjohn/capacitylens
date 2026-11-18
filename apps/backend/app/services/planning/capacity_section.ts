import { normalizeAccountWorkingDays } from '@capacitylens/shared/lib/accountWorkingDays';
import {
  applyCapacityMode,
  buildDayCapacity,
  resolveAllocatedHoursForWeekday,
} from '@capacitylens/shared/lib/capacity';
import type {
  CapacityDays,
  CapacityRange,
  CapacitySection,
  ResourceCapacity,
} from '@capacitylens/shared/lib/capacity';
import {
  addDaysISO,
  bucketByCoveredDate,
  eachDayISO,
  rangesOverlap,
  startOfWeekISO,
  weekdayOf,
} from '@capacitylens/shared/lib/dateMath';
import { effectiveWorkingWeek } from '@capacitylens/shared/lib/effectiveWorkingWeek';
import {
  CAPACITY_OVERVIEW_HORIZON_WEEKS,
  DEFAULT_RANGE_DAYS,
  PAST_BUFFER_DAYS,
  UTILISATION_WINDOW_DAYS,
} from '@capacitylens/shared/lib/planningWindows';
import { isCapacityTracked } from '@capacitylens/shared/types/entities';
import type { Account, AppData, ISODate } from '@capacitylens/shared/types/entities';

interface BuildCapacitySectionInput {
  /** The active rows the reader receives. */
  data: AppData;
  account: Account | undefined;
  today: ISODate;
  /** The requested window; the scheduler's default window when absent. */
  window?: CapacityRange | undefined;
}

/** The window the scheduler materialises for today: four weeks before the current week, 148 days. */
function buildDefaultCapacityWindow(today: ISODate, weekStartsOn: 0 | 1): CapacityRange {
  const from = addDaysISO(startOfWeekISO(today, weekStartsOn), -PAST_BUFFER_DAYS);
  return { from, to: addDaysISO(from, PAST_BUFFER_DAYS + DEFAULT_RANGE_DAYS - 1) };
}

function groupByResource<T extends { resourceId: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const list = grouped.get(row.resourceId);
    if (list) list.push(row);
    else grouped.set(row.resourceId, [row]);
  }
  return grouped;
}

/** Computes the planning read's capacity section with the shared capacity rules. */
export function buildCapacitySection({
  data,
  account,
  today,
  window,
}: BuildCapacitySectionInput): CapacitySection {
  const weekStartsOn = account?.weekStartsOn ?? 1;
  const accountWorkingDays = normalizeAccountWorkingDays(account?.workingDays, weekStartsOn);
  const blocksMode = account?.schedulingMode === 'blocks';
  const range = window ?? buildDefaultCapacityWindow(today, weekStartsOn);
  const horizon = {
    from: today,
    to: addDaysISO(
      startOfWeekISO(today, weekStartsOn),
      CAPACITY_OVERVIEW_HORIZON_WEEKS['12-weeks'] * 7 - 1
    ),
  };
  // The window and the horizon may overlap, so each date is computed once, in date order, and
  // each range is a slice. The overSoon days lie inside the horizon, which runs at least 11 weeks
  // past today.
  const dates = Array.from(
    new Set([...eachDayISO(range.from, range.to), ...eachDayISO(horizon.from, horizon.to)])
  ).sort();
  const buildBounds = ({ from, to }: CapacityRange) =>
    [dates.indexOf(from), dates.indexOf(to) + 1] as const;
  const windowBounds = buildBounds(range);
  const horizonBounds = buildBounds(horizon);
  const overSoonBounds = buildBounds({
    from: today,
    to: addDaysISO(today, UTILISATION_WINDOW_DAYS - 1),
  });
  // Only rows that reach a computed date can count, then each is indexed under the dates it covers.
  const first = range.from < horizon.from ? range.from : horizon.from;
  const last = range.to > horizon.to ? range.to : horizon.to;
  const isInWindow = (row: { startDate: ISODate; endDate: ISODate }) =>
    rangesOverlap(row.startDate, row.endDate, first, last);
  const allocationsByResource = groupByResource(data.allocations.filter(isInWindow));
  const timeOffByResource = groupByResource(data.timeOff.filter(isInWindow));
  const closuresByDate = bucketByCoveredDate(data.closures.filter(isInWindow), dates);

  const resources: Record<string, ResourceCapacity> = {};
  for (const resource of data.resources.filter(isCapacityTracked)) {
    const allocationsByDate = bucketByCoveredDate(
      applyCapacityMode({
        allocations: allocationsByResource.get(resource.id) ?? [],
        blocksMode,
      }),
      dates
    );
    const timeOffByDate = bucketByCoveredDate(timeOffByResource.get(resource.id) ?? [], dates);
    const effectiveWeek = effectiveWorkingWeek(resource, accountWorkingDays);
    const all: CapacityDays = { allocated: [], confirmedAllocated: [], available: [], over: [] };
    for (const date of dates) {
      const allocations = allocationsByDate.get(date) ?? [];
      const day = buildDayCapacity({
        resource,
        date,
        allocations,
        timeOff: timeOffByDate.get(date) ?? [],
        effectiveWeek,
        closures: closuresByDate.get(date) ?? [],
      });
      // Availability does not depend on status, so only the confirmed load is summed again.
      const confirmed = allocations.some((allocation) => allocation.status === 'tentative')
        ? resolveAllocatedHoursForWeekday({
            resource,
            date,
            allocations: allocations.filter((allocation) => allocation.status !== 'tentative'),
            weekday: weekdayOf(date),
            effectiveWeek,
          })
        : day.allocated;
      all.allocated.push(day.allocated);
      all.confirmedAllocated.push(confirmed);
      all.available.push(day.available);
      all.over.push(day.over);
    }
    const sliceDays = ([start, end]: readonly [number, number]): CapacityDays => ({
      allocated: all.allocated.slice(start, end),
      confirmedAllocated: all.confirmedAllocated.slice(start, end),
      available: all.available.slice(start, end),
      over: all.over.slice(start, end),
    });
    resources[resource.id] = {
      overSoon: all.over.slice(...overSoonBounds).some(Boolean),
      window: sliceDays(windowBounds),
      horizon: sliceDays(horizonBounds),
    };
  }
  return { window: range, horizon, resources };
}
