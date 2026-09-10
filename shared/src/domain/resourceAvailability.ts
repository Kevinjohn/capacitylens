import { eachDayISO, weekdayOf } from "../lib/dateMath";
import { effectiveWorkingWeek, effectiveWeekIncludes } from "../lib/effectiveWorkingWeek";
import { isValidISODate } from "../lib/integrity";
import { isExternalResource, isPlaceholderResource } from "../types/entities";
import type { Allocation, ISODate, Resource, Weekday } from "../types/entities";
import { domainError } from "./errors";

export interface ResourceAvailabilityInput {
  allocation: Pick<Allocation, "startDate" | "endDate" | "ignoreWeekends">;
  resource: Pick<Resource, "kind" | "workingDays" | "firstAvailableDate" | "lastAvailableDate">;
  /** Company working days are required so boundaries only apply to days on which this person is
   * actually schedulable. The intersection is also the same calendar used by capacity math. */
  accountWorkingDays: Weekday[];
}

/** Enforce inclusive person availability boundaries on an allocation's scheduled days. */
export function assertAllocationWithinResourceAvailability({
  allocation,
  resource,
  accountWorkingDays,
}: ResourceAvailabilityInput): void {
  if (isPlaceholderResource(resource) || isExternalResource(resource)) return;
  const first = resource.firstAvailableDate;
  const last = resource.lastAvailableDate;
  if (first === undefined && last === undefined) return;
  const effectiveWeek = effectiveWorkingWeek(resource, accountWorkingDays);
  const scheduledDates = eachDayISO(allocation.startDate, allocation.endDate).filter(
    (date) => allocation.ignoreWeekends === true || effectiveWeekIncludes(effectiveWeek, weekdayOf(date)),
  );
  for (const date of scheduledDates) {
    if (first !== undefined && date < first) {
      domainError(
        "allocation_before_resource_availability",
        "Allocation includes a scheduled working day before this person is available.",
      );
    }
    if (last !== undefined && date > last) {
      domainError(
        "allocation_after_resource_availability",
        "Allocation includes a scheduled working day after this person is available.",
      );
    }
  }
}

/** Validate a person availability pair without applying an allocation placement policy. */
export function validateResourceAvailabilityPair(
  firstAvailableDate?: ISODate,
  lastAvailableDate?: ISODate,
): { ok: true } | { ok: false; code: "date_invalid" | "date_reversed" } {
  if (
    (firstAvailableDate !== undefined && !isValidISODate(firstAvailableDate)) ||
    (lastAvailableDate !== undefined && !isValidISODate(lastAvailableDate))
  ) {
    return { ok: false, code: "date_invalid" };
  }
  if (firstAvailableDate !== undefined && lastAvailableDate !== undefined && firstAvailableDate > lastAvailableDate) {
    return { ok: false, code: "date_reversed" };
  }
  return { ok: true };
}
