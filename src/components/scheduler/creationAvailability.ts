import { weekdayOf } from "@capacitylens/shared/lib/dateMath";
import { isExternalResource } from "@capacitylens/shared/types/entities";
import type { ISODate, Resource, TimeOff, Weekday } from "@capacitylens/shared/types/entities";

/** Recurring weekdays on which an allocation may start for this resource. Company closure wins;
 *  externals have no personal capacity pattern, so only the company calendar applies to them. */
export function effectiveWorkingDays(resource: Resource, accountWorkingDays: Weekday[]): Weekday[] {
  if (isExternalResource(resource)) return accountWorkingDays;
  const personalWorkingDays = new Set(resource.workingDays);
  return accountWorkingDays.filter((weekday) => personalWorkingDays.has(weekday));
}

/** Whether recurring company/personal calendars reject an EXISTING allocation's proposed start.
 *  The allocation-level override intentionally bypasses both; time off is a separate conflict. */
export function isAllocationMoveStartBlocked(
  resource: Resource,
  date: ISODate,
  accountWorkingDays: Weekday[],
  ignoreWorkingDays: boolean | undefined,
): boolean {
  if (ignoreWorkingDays) return false;
  return !effectiveWorkingDays(resource, accountWorkingDays).includes(weekdayOf(date));
}

/** Whether a schedule gesture may begin on this date. Spans may cross later blocked dates. */
export function isCreationStartBlocked(
  resource: Resource,
  date: ISODate,
  timeOff: TimeOff[],
  accountWorkingDays: Weekday[],
): boolean {
  if (isAllocationMoveStartBlocked(resource, date, accountWorkingDays, false)) return true;
  if (isExternalResource(resource)) return false;
  return timeOff.some((entry) => entry.startDate <= date && entry.endDate >= date);
}
