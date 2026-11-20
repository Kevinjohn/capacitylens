import { assertAllocationWithinResourceAvailability } from './resourceAvailability.js';
import { resolveScheduledHoursOnDay } from '../lib/capacity/availability.js';
import type { EffectiveWorkingWeek } from '../lib/effectiveWorkingWeek.js';
import { FULL_DAY_HOURS, isExternalResource } from '../types/entities.js';
import type { Allocation, ISODate, Resource, Weekday } from '../types/entities.js';

type AllocationPlacement = Pick<Allocation, 'resourceId' | 'startDate' | 'endDate'> &
  Partial<Pick<Allocation, 'ignoreWorkingDays'>>;

/** Inputs resolved by the caller for one allocation availability check. */
export interface AssertAllocationPlacementInput {
  allocation: AllocationPlacement;
  existing?: AllocationPlacement;
  resource: Pick<Resource, 'kind' | 'workingDays'> &
    Partial<Pick<Resource, 'firstAvailableDate' | 'lastAvailableDate'>>;
  companyWorkingDays: Weekday[];
}

/** Check availability only when a new or changed allocation placement is proposed. */
export function assertAllocationPlacement({
  allocation,
  existing,
  resource,
  companyWorkingDays,
}: AssertAllocationPlacementInput): void {
  if (
    existing &&
    allocation.resourceId === existing.resourceId &&
    allocation.startDate === existing.startDate &&
    allocation.endDate === existing.endDate &&
    (allocation.ignoreWorkingDays === true) === (existing.ignoreWorkingDays === true)
  ) {
    return;
  }

  assertAllocationWithinResourceAvailability({ allocation, resource, companyWorkingDays });
}

/** Inputs for the load an allocation carries after it is reassigned to another resource. */
export interface ReconcileReassignedHoursInput {
  current: number;
  target: Resource;
  zeroLoadMode: boolean;
  startDate: ISODate;
  effectiveWeek: EffectiveWorkingWeek;
}

/** Hours/day an allocation should carry after being reassigned (dragged) to `target`. An external
 * / 3rd party always carries no load (0). In Hours/Days mode, a zero-hour booking dragged off an
 * external is promoted to the target's working day because those forms require positive load.
 * Blocks mode deliberately permits and preserves zero; existing positive historical values are
 * also retained for a real→real reassign. The server applies this to `allocation.reassign`. */
export function reconcileReassignedHours({
  current,
  target,
  zeroLoadMode,
  startDate,
  effectiveWeek,
}: ReconcileReassignedHoursInput): number {
  if (isExternalResource(target)) return 0;
  if (current > 0 || zeroLoadMode) return current;
  return resolveScheduledHoursOnDay(target, startDate, effectiveWeek) || FULL_DAY_HOURS;
}
