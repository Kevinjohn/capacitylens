import { weekdayOf } from "@capacitylens/shared/lib/dateMath";
import { isExternalResource } from "@capacitylens/shared/types/entities";
import { isOnTimeOff } from "../../lib/capacity";
import type { ISODate, Resource, TimeOff, Weekday } from "@capacitylens/shared/types/entities";

/** Recurring weekdays on which an allocation may start for this resource. Company closure wins;
 *  externals have no personal capacity pattern, so only the company calendar applies to them. */
export function effectiveWorkingDays(resource: Resource, accountWorkingDays: Weekday[]): Weekday[] {
  if (isExternalResource(resource)) return accountWorkingDays;
  const personalWorkingDays = new Set(resource.workingDays);
  return accountWorkingDays.filter((weekday) => personalWorkingDays.has(weekday));
}

/** Why a schedule gesture may not begin on a date: the recurring company/personal calendars reject
 *  it, or the resource is on time off. Distinct because the two are separately overridable — an
 *  allocation-level `ignoreWorkingDays` bypasses the calendars only. */
export type CreationBlockReason = "non-working" | "time-off";

/** No time off to consider — a move gate asks the calendars only, and a shared empty array keeps
 *  that from allocating on a per-pointermove path. */
const NO_TIME_OFF: TimeOff[] = [];

/** THE start-of-gesture gate, shared by every surface that asks "may a bar start on this
 *  resource-day?" (the model's per-day `creationBlocked`, the grid's draw commit, and the
 *  drag/keyboard move paths). Returns the REASON so a caller that must tell the two apart can,
 *  without re-deriving either rule. `timeOff` need not be pre-filtered by resource. */
export function creationBlockedAt(
  resource: Resource,
  date: ISODate,
  timeOff: TimeOff[],
  accountWorkingDays: Weekday[],
  ignoreWorkingDays?: boolean,
): CreationBlockReason | null {
  if (!ignoreWorkingDays && !effectiveWorkingDays(resource, accountWorkingDays).includes(weekdayOf(date))) {
    return "non-working";
  }
  // Externals are an awareness band with no capacity of their own: only the company calendar above
  // applies to them, never time off.
  if (isExternalResource(resource)) return null;
  return isOnTimeOff(resource.id, date, timeOff) ? "time-off" : null;
}

/** Whether recurring company/personal calendars reject an EXISTING allocation's proposed start.
 *  The allocation-level override intentionally bypasses both; time off is a separate conflict. */
export function isAllocationMoveStartBlocked(
  resource: Resource,
  date: ISODate,
  accountWorkingDays: Weekday[],
  ignoreWorkingDays: boolean | undefined,
): boolean {
  return creationBlockedAt(resource, date, NO_TIME_OFF, accountWorkingDays, ignoreWorkingDays) !== null;
}

/** Whether a schedule gesture may begin on this date. Spans may cross later blocked dates. */
export function isCreationStartBlocked(
  resource: Resource,
  date: ISODate,
  timeOff: TimeOff[],
  accountWorkingDays: Weekday[],
): boolean {
  return creationBlockedAt(resource, date, timeOff, accountWorkingDays, false) !== null;
}
