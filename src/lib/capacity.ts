import { eachDayISO, weekdayOf } from "@capacitylens/shared/lib/dateMath";
import type { EffectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import type { Allocation, Closure, ISODate, Resource, TimeOff } from "@capacitylens/shared/types/entities";
import { allocatedHoursForWeekday, availableHoursForWeekday } from "./capacity/availability";

export * from "./capacity/availability";
export * from "./capacity/advisory";
export * from "./capacity/advisoryCopy";

export * from "./capacity/primitives";
import { exceedsCapacity } from "./capacity/primitives";

export interface DayCapacity {
  date: ISODate;
  allocated: number;
  available: number;
  over: boolean;
}

/** Allocated vs. available hours for one resource-day, with the `over` flag (allocated > available).
 *  @remarks Assumes finite, non-negative hours (see the top-of-file precondition). */
export function dayCapacity(
  resource: Resource,
  date: ISODate,
  allocations: Allocation[],
  timeOff: TimeOff[],
  effectiveWeek: EffectiveWorkingWeek,
  closures: Closure[],
): DayCapacity {
  // ONE parseISO for the whole resource-day: the availability and load halves each need the
  // weekday (twice over, for the working-week and half-day tests), and this runs per resource ×
  // per visible day on every model rebuild.
  const weekday = weekdayOf(date);
  const available = availableHoursForWeekday(resource, date, timeOff, closures, weekday, effectiveWeek);
  const allocated = allocatedHoursForWeekday(resource, date, allocations, weekday, effectiveWeek);
  return {
    date,
    allocated,
    available,
    over: exceedsCapacity(allocated, available),
  };
}

/** Whole-window capacity, one entry per calendar day, derived straight from the inputs.
 *  The render path does NOT come through here: buildSchedulerModel walks the SAME window for every
 *  resource, so it builds the day array once, buckets each resource's allocations and time off by
 *  covered date (`bucketByCoveredDate`), and memoises `dayCapacity` per date. This stays the
 *  straight-line definition those optimisations are checked against. */
export function capacityForWindow(
  resource: Resource,
  allocations: Allocation[],
  timeOff: TimeOff[],
  start: ISODate,
  end: ISODate,
  effectiveWeek: EffectiveWorkingWeek,
  closures: Closure[],
): DayCapacity[] {
  return eachDayISO(start, end).map((d) => dayCapacity(resource, d, allocations, timeOff, effectiveWeek, closures));
}

/** Reduce already-computed resource-day capacity into the visible-window utilisation ratio. */
export function utilizationFromCapacity(days: Iterable<DayCapacity>): number {
  let allocated = 0;
  let available = 0;
  for (const day of days) {
    if (day.available === 0) continue; // not a working day — neither side counts
    allocated += day.allocated;
    available += day.available;
  }
  return available === 0 ? 0 : allocated / available;
}

/** Allocated / available over the window, counted over working days only.
 *  Returns 0 when there is no availability. Non-working days (weekends / time off)
 *  are skipped entirely — counting their allocated hours against zero availability
 *  would push a normal allocation that merely spans a weekend past 100%.
 *  Like `capacityForWindow`, this is the straight-line definition; the render path reaches the same
 *  number through `utilizationFromCapacity` over its memoised per-date capacity. */
export function utilization(
  resource: Resource,
  allocations: Allocation[],
  timeOff: TimeOff[],
  start: ISODate,
  end: ISODate,
  effectiveWeek: EffectiveWorkingWeek,
  closures: Closure[],
): number {
  return utilizationFromCapacity(
    capacityForWindow(resource, allocations, timeOff, start, end, effectiveWeek, closures),
  );
}
