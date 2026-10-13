import { assertAllocationWithinResourceAvailability } from "./resourceAvailability.js";
import type { Allocation, Resource, Weekday } from "../types/entities.js";

type AllocationPlacement = Pick<Allocation, "resourceId" | "startDate" | "endDate" | "ignoreWeekends">;

/** Inputs resolved by the caller for one allocation availability check. */
export interface AssertAllocationPlacementInput {
  allocation: AllocationPlacement;
  existing?: AllocationPlacement;
  resource: Pick<Resource, "kind" | "workingDays" | "firstAvailableDate" | "lastAvailableDate">;
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
    (allocation.ignoreWeekends === true) === (existing.ignoreWeekends === true)
  ) {
    return;
  }

  assertAllocationWithinResourceAvailability({ allocation, resource, accountWorkingDays });
}
