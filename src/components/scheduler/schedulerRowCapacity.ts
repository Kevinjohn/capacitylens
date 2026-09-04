import { capacityAllocationsForMode, dayCapacity, utilizationFromCapacity, type DayCapacity } from "../../lib/capacity";
import { eachDayISO } from "@capacitylens/shared/lib/dateMath";
import type { EffectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import {
  isExternalResource,
  type Allocation,
  type Closure,
  type ISODate,
  type Resource,
  type TimeOff,
} from "@capacitylens/shared/types/entities";
import { bucketByCoveredDate, NO_ALLOCATIONS, NO_TIME_OFF, NO_CLOSURES } from "./schedulerModelIndexing";
import type { CapacitySource, SchedulerModelOptions } from "./schedulerModelTypes";

export function createCapacitySource(
  days: ISODate[],
  { start: visStart, end: visEnd }: SchedulerModelOptions["visibleWindow"],
  { start: overStart, end: overEnd }: SchedulerModelOptions["overSoonWindow"],
  closures: Closure[],
  blocksMode: boolean,
) {
  // The [visStart, visEnd] and [overStart, overEnd] windows are RESOURCE-INVARIANT — every row in
  // this model reads the exact same two windows. Building their day arrays here ONCE avoids resources
  // × (visibleDays + 14) redundant eachDayISO calls per model rebuild (this fires on every scroll-day
  // change, zoom, filter keystroke and edit). Each row separately caches its computed resource-day
  // results below, so dates shared by the timeline, visible window and fixed overSoon window scan
  // that resource's allocations/time off only once. Not sliced from `days`: `days` covers the
  // SCROLLABLE timeline, while overStart/overEnd
  // is a FIXED window anchored on today that can fall outside it (and visStart/visEnd, though always
  // within `days` in practice, isn't worth a fragile index-based slice to save one extra pair of calls).
  const visDays = eachDayISO(visStart, visEnd);
  const overDays = eachDayISO(overStart, overEnd);
  // Every per-day capacity lookup below asks for a date drawn from one of those three arrays, so
  // their sorted, de-duplicated union is the COMPLETE set of dates any row can query. Bucketing a
  // resource's allocations / time off onto it once (see bucketByCoveredDate) is what turns the
  // per-row day loop from O(days × allocations) into O(days + coverage). Resource-invariant, so it
  // is built here once rather than per row. ISO dates sort lexicographically = chronologically.
  const capacityDates = Array.from(new Set([...days, ...visDays, ...overDays])).sort();
  const capacityDateSet = new Set(capacityDates);
  const closuresByDate = bucketByCoveredDate(closures, capacityDates);

  const NO_CAPACITY = (date: ISODate): DayCapacity => ({ date, allocated: 0, available: 0, over: false });
  const capacitySourceFor = (
    resource: Resource,
    allocations: Allocation[],
    resTimeOff: TimeOff[],
    effectiveWeek: EffectiveWorkingWeek,
  ): CapacitySource => {
    if (isExternalResource(resource)) {
      return {
        tracked: false,
        timeOffOn: () => NO_TIME_OFF,
        capacityOnDay: NO_CAPACITY,
        allocationCountOn: () => 0,
        timeOffCountOn: () => 0,
        utilizationOver: () => 0,
        overOn: () => false,
      };
    }
    // Capacity reflects ALL the resource's allocations (truthful load), not the filtered view.
    const capacityAllocs = capacityAllocationsForMode(allocations, blocksMode);
    const rowTimeOff = resTimeOff;
    // Bucket this resource's load and time off by the days they cover, ONCE, so each of the
    // ~150 timeline days hands capacity.ts only the rows that actually touch that day instead
    // of making it rescan every allocation (and every time-off row) per day.
    const allocsByDate = bucketByCoveredDate(capacityAllocs, capacityDates);
    const personalTimeOffByDate = bucketByCoveredDate(resTimeOff, capacityDates);
    const capacityByDate = new Map<ISODate, DayCapacity>();
    const capacityOnDay = (date: ISODate): DayCapacity => {
      const cached = capacityByDate.get(date);
      if (cached) return cached;
      // A date outside `capacityDates` has no bucket to read (an empty bucket and "not
      // bucketed" are indistinguishable), so fall back to the full lists. Nothing queries
      // such a date today; this keeps a future caller correct rather than silently empty.
      const computed = capacityDateSet.has(date)
        ? dayCapacity(
            resource,
            date,
            allocsByDate.get(date) ?? NO_ALLOCATIONS,
            personalTimeOffByDate.get(date) ?? NO_TIME_OFF,
            effectiveWeek,
            closuresByDate.get(date) ?? NO_CLOSURES,
          )
        : dayCapacity(resource, date, capacityAllocs, rowTimeOff, effectiveWeek, closures);
      capacityByDate.set(date, computed);
      return computed;
    };
    const timeOffOn = (date: ISODate) =>
      capacityDateSet.has(date) ? (personalTimeOffByDate.get(date) ?? NO_TIME_OFF) : rowTimeOff;
    return {
      tracked: true,
      timeOffOn,
      capacityOnDay,
      allocationCountOn: (date) => allocsByDate.get(date)?.length ?? 0,
      timeOffCountOn: (date) =>
        timeOffOn(date).length +
        (capacityDateSet.has(date)
          ? (closuresByDate.get(date)?.length ?? 0)
          : closures.filter((closure) => closure.startDate <= date && closure.endDate >= date).length),
      utilizationOver: (dates) => utilizationFromCapacity(dates.map(capacityOnDay)),
      overOn: (dates) => dates.some((date) => capacityOnDay(date).over),
    };
  };

  return { capacitySourceFor, visDays, overDays };
}
