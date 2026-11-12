import { assertAllocationWithinResourceAvailability } from './resourceAvailability.js';
import type { Allocation, Resource, Weekday } from '../types/entities.js';

type AllocationPlacement = Pick<Allocation, 'resourceId' | 'startDate' | 'endDate'> &
  Partial<Pick<Allocation, 'ignoreWorkingDays'>>;

/** Inputs resolved by the caller for one allocation availability check. */
export interface AssertAllocationPlacementInput {
  allocation: AllocationPlacement;
  existing?: AllocationPlacement;
  resource: Pick<Resource, 'kind' | 'workingDays'> &
    Partial<Pick<Resource, 'firstAvailableDate' | 'lastAvailableDate'>>;
  accountWorkingDays: Weekday[];
}

/** Check availability only when a new or changed allocation placement is proposed. */
export function assertAllocationPlacement({
  allocation,
  existing,
  resource,
  accountWorkingDays,
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

  assertAllocationWithinResourceAvailability({ allocation, resource, accountWorkingDays });
}
