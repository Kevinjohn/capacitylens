import { weekdayOf } from "@capacitylens/shared/lib/dateMath";
import { isExternalResource } from "@capacitylens/shared/types/entities";
import type { ISODate, Resource, TimeOff, Weekday } from "@capacitylens/shared/types/entities";

/** Whether a schedule gesture may begin on this date. Spans may cross later blocked dates. */
export function isCreationStartBlocked(
  resource: Resource,
  date: ISODate,
  timeOff: TimeOff[],
  accountWorkingDays: Weekday[],
): boolean {
  const weekday = weekdayOf(date);
  if (!accountWorkingDays.includes(weekday)) return true;
  if (isExternalResource(resource)) return false;
  if (!resource.workingDays.includes(weekday)) return true;
  return timeOff.some((entry) => entry.startDate <= date && entry.endDate >= date);
}
