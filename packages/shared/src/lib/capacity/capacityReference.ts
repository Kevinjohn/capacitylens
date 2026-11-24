import { getWeekday } from '../dateMath.js';
import type { EffectiveWorkingWeek } from '../effectiveWorkingWeek.js';
import type { Allocation, Closure, ISODate, Resource, TimeOff } from '../../types/entities.js';
import {
  buildCapacityWindow,
  resolveAllocatedHoursForWeekday,
  resolveAvailableHoursForWeekday,
  resolveUtilisationFromCapacity,
} from '../capacity.js';

// Test-only reference definitions. Nothing in production calls these and the package does not export
// this module; capacityTestKit.ts wraps them for the capacity tests.

interface ResolveAvailableHoursOnDayInput {
  resource: Resource;
  date: ISODate;
  timeOff: TimeOff[];
  effectiveWeek: EffectiveWorkingWeek;
  closures: Closure[];
}

/** Available working hours for `resource` on `date`: 0 on a non-working weekday or time off,
 * fixed 4h on a half day, otherwise fixed 8h. */
export function resolveAvailableHoursOnDay({
  resource,
  date,
  timeOff,
  effectiveWeek,
  closures,
}: ResolveAvailableHoursOnDayInput): number {
  return resolveAvailableHoursForWeekday({
    resource,
    date,
    timeOff,
    closures,
    weekday: getWeekday(date),
    effectiveWeek,
  });
}

interface ResolveAllocatedHoursOnDayInput {
  resource: Resource;
  date: ISODate;
  allocations: Allocation[];
  effectiveWeek: EffectiveWorkingWeek;
}

/** Totals the allocation hours assigned to `resource` on `date`, respecting effective working days. */
export function resolveAllocatedHoursOnDay({
  resource,
  date,
  allocations,
  effectiveWeek,
}: ResolveAllocatedHoursOnDayInput): number {
  return resolveAllocatedHoursForWeekday({
    resource,
    date,
    allocations,
    weekday: getWeekday(date),
    effectiveWeek,
  });
}

interface ResolveUtilisationInput {
  resource: Resource;
  allocations: Allocation[];
  timeOff: TimeOff[];
  start: ISODate;
  end: ISODate;
  effectiveWeek: EffectiveWorkingWeek;
  closures: Closure[];
}

/** Allocated / available over the window, counted over working days only.
 * Returns 0 when there is no availability. Non-working days (weekends / time off)
 * are skipped entirely, counting their allocated hours against zero availability
 * would push a normal allocation that merely spans a weekend past 100%.
 * Like `buildCapacityWindow`, this is the straight-line definition; the render path reaches the same
 * number through `resolveUtilisationFromCapacity` over its memoised per-date capacity. */
export function resolveUtilisation({
  resource,
  allocations,
  timeOff,
  start,
  end,
  effectiveWeek,
  closures,
}: ResolveUtilisationInput): number {
  return resolveUtilisationFromCapacity(
    buildCapacityWindow({
      resource,
      allocations,
      timeOff,
      start,
      end,
      effectiveWeek,
      closures,
    }),
  );
}
