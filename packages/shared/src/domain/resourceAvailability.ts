import { eachDayISO, weekdayOf } from "../lib/dateMath.js";
import { effectiveWorkingWeek, effectiveWeekIncludes } from "../lib/effectiveWorkingWeek.js";
import { isValidISODate } from "../lib/integrity.js";
import type { ValidationResult } from "../lib/integrity.js";
import { isExternalResource, isPlaceholderResource } from "../types/entities.js";
import type { Allocation, ISODate, Resource, Weekday } from "../types/entities.js";
import { throwDomainError } from "./errors.js";

/** The allocation span, resource and company working days an availability check needs. */
export interface ResourceAvailabilityInput {
  allocation: Pick<Allocation, "startDate" | "endDate"> & Partial<Pick<Allocation, "ignoreWeekends">>;
  resource: Pick<Resource, "kind" | "workingDays"> &
    Partial<Pick<Resource, "firstAvailableDate" | "lastAvailableDate">>;
  /** Company working days are required so boundaries only apply to days on which this person is
   * actually schedulable. The intersection is also the same calendar used by capacity math. */
  accountWorkingDays: Weekday[];
}

/** Enforce inclusive person availability on scheduled days without mutating the input.
 * Dates must be validated ISO dates and the allocation range must fit the materialization limit.
 * Placeholders and external resources are exempt; person days use the effective working week unless ignoreWeekends is true.
 * @throws DomainError when a scheduled day falls outside availability; do not persist the allocation. */
export function assertAllocationWithinResourceAvailability({
  allocation,
  resource,
  accountWorkingDays,
}: ResourceAvailabilityInput): void {
  if (isPlaceholderResource(resource) || isExternalResource(resource)) return;
  const first = resource.firstAvailableDate;
  const last = resource.lastAvailableDate;
  if (first == null && last == null) return;
  const effectiveWeek = effectiveWorkingWeek(resource, accountWorkingDays);
  const scheduledDates = eachDayISO(allocation.startDate, allocation.endDate).filter(
    (date) => allocation.ignoreWeekends === true || effectiveWeekIncludes(effectiveWeek, weekdayOf(date)),
  );
  for (const date of scheduledDates) {
    if (first != null && date < first) {
      throwDomainError(
        "allocation_before_resource_availability",
        "Allocation includes a scheduled working day before this person is available.",
      );
    }
    if (last != null && date > last) {
      throwDomainError(
        "allocation_after_resource_availability",
        "Allocation includes a scheduled working day after this person is available.",
      );
    }
  }
}

/** Validate a person availability pair without applying an allocation placement policy. */
export function validateResourceAvailabilityPair(
  firstAvailableDate?: ISODate | null,
  lastAvailableDate?: ISODate | null,
): ValidationResult {
  if (
    (firstAvailableDate != null && !isValidISODate(firstAvailableDate)) ||
    (lastAvailableDate != null && !isValidISODate(lastAvailableDate))
  ) {
    return {
      ok: false,
      errors: ["Availability dates must be valid calendar dates (YYYY-MM-DD)."],
      codes: ["date_invalid"],
    };
  }
  if (firstAvailableDate != null && lastAvailableDate != null && firstAvailableDate > lastAvailableDate) {
    return {
      ok: false,
      errors: ["First available date cannot be after last available date."],
      codes: ["date_reversed"],
    };
  }
  return { ok: true, errors: [], codes: [] };
}
