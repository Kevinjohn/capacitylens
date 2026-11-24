import { listDaysISO, getWeekday } from './dateMath.js';
import type { EffectiveWorkingWeek } from './effectiveWorkingWeek.js';
import type { Allocation, Closure, ISODate, Resource, TimeOff } from '../types/entities.js';
import {
  resolveAllocationLoadForWeekday,
  resolveAvailableHoursForWeekday,
} from './capacity/availability.js';

export * from './capacity/availability.js';
export * from './capacity/advisory.js';

export * from './capacity/primitives.js';
export type * from './capacity/section.js';
import { hasOverCapacity } from './capacity/primitives.js';

interface BuildDayCapacityInput {
  resource: Resource;
  date: ISODate;
  allocations: Allocation[];
  timeOff: TimeOff[];
  effectiveWeek: EffectiveWorkingWeek;
  closures: Closure[];
}

interface BuildCapacityWindowInput {
  resource: Resource;
  allocations: Allocation[];
  timeOff: TimeOff[];
  start: ISODate;
  end: ISODate;
  effectiveWeek: EffectiveWorkingWeek;
  closures: Closure[];
}

/** Available and allocated capacity values for one date. */
export interface DayCapacity {
  date: ISODate;
  allocated: number;
  available: number;
  over: boolean;
}

/** Allocated and available hours for one resource-day; over means allocated exceeds capacity beyond numeric tolerance.
 * @remarks Requires finite non-negative hours, as documented in capacity/primitives.ts.
 */
export function buildDayCapacity({
  resource,
  date,
  allocations,
  timeOff,
  effectiveWeek,
  closures,
}: BuildDayCapacityInput): DayCapacity {
  // One parseISO for the whole resource-day: the availability and load halves each need the
  // weekday (twice over, for the working-week and half-day tests), and this runs per resource ×
  // per visible day on every model rebuild.
  const weekday = getWeekday(date);
  const available = resolveAvailableHoursForWeekday({
    resource,
    date,
    timeOff,
    closures,
    weekday,
    effectiveWeek,
  });
  const load = resolveAllocationLoadForWeekday({
    resource,
    date,
    allocations,
    weekday,
    effectiveWeek,
  });
  return {
    date,
    allocated: load.hours,
    available,
    over: hasOverCapacity(load.components, available),
  };
}

/** Whole-window capacity, one entry per calendar day, derived straight from the inputs.
 * The render path does not come through here: buildSchedulerModel walks the same window for every
 * resource, so it builds the day array once, buckets each resource's allocations and time off by
 * covered date (`bucketByCoveredDate`), and memoises `buildDayCapacity` per date. This stays the
 * straight-line definition those optimisations are checked against. */
export function buildCapacityWindow({
  resource,
  allocations,
  timeOff,
  start,
  end,
  effectiveWeek,
  closures,
}: BuildCapacityWindowInput): DayCapacity[] {
  return listDaysISO(start, end).map((day) =>
    buildDayCapacity({
      resource,
      date: day,
      allocations,
      timeOff,
      effectiveWeek,
      closures,
    }),
  );
}

/** Reduce already-computed resource-day capacity into the visible-window utilisation ratio. */
export function resolveUtilisationFromCapacity(days: Iterable<DayCapacity>): number {
  let allocated = 0;
  let available = 0;
  for (const day of days) {
    // Skip days with no available capacity so neither their availability nor their booked hours enter visible utilisation.
    if (day.available === 0) continue;
    allocated += day.allocated;
    available += day.available;
  }
  return available === 0 ? 0 : allocated / available;
}
