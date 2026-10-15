import { isWithin, weekdayOf } from "@capacitylens/shared/lib/dateMath";
import { effectiveWeekIncludes } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import type { EffectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import {
  FULL_DAY_HOURS,
  HALF_DAY_HOURS,
  hasPersonalWorkingPattern,
  isExternalResource,
} from "@capacitylens/shared/types/entities";
import type { Allocation, Closure, ID, ISODate, Resource, TimeOff, Weekday } from "@capacitylens/shared/types/entities";
import { hasAllocationLoadOnDay, warnOnNonFiniteCapacity } from "./primitives";

/** Checks whether a date belongs to the effective working week. */
export function isWorkingDay(effectiveWeek: EffectiveWorkingWeek, date: ISODate): boolean {
  return effectiveWeekIncludes(effectiveWeek, weekdayOf(date));
}

/** A saved half-day working pattern on this weekday, 4h of capacity instead of 8h. The scheduler's
 * partial-capacity tint asks the same question, so both read this one definition. */
export function isHalfDay(resource: Resource, weekday: Weekday): boolean {
  return hasPersonalWorkingPattern(resource) && resource.halfDays.includes(weekday);
}

/** Returns scheduled hours for a resource on a weekday. */
export function resolveScheduledHoursForWeekday(
  resource: Resource,
  weekday: Weekday,
  effectiveWeek: EffectiveWorkingWeek,
): number {
  if (!effectiveWeekIncludes(effectiveWeek, weekday)) return 0;
  return isHalfDay(resource, weekday) ? HALF_DAY_HOURS : FULL_DAY_HOURS;
}

/** Fixed capacity before time off: 8h full day, 4h half day, or 0 when not working. */
export function resolveScheduledHoursOnDay(
  resource: Resource,
  date: ISODate,
  effectiveWeek: EffectiveWorkingWeek,
): number {
  if (resource.kind === "person" && resource.firstAvailableDate && date < resource.firstAvailableDate) return 0;
  if (resource.kind === "person" && resource.lastAvailableDate && date > resource.lastAvailableDate) return 0;
  return resolveScheduledHoursForWeekday(resource, weekdayOf(date), effectiveWeek);
}

function isApplicableToResource(resourceId: ID, timeOffEntry: TimeOff): boolean {
  return timeOffEntry.resourceId === resourceId;
}

/** The personal time-off entries that apply to this resource. */
export function listTimeOffApplyingTo(resourceId: ID, timeOff: TimeOff[]): TimeOff[] {
  return timeOff.filter((timeOffEntry) => isApplicableToResource(resourceId, timeOffEntry));
}

/** Checks whether a resource has time off on a date. */
export function isOnTimeOff(resourceId: ID, date: ISODate, timeOff: TimeOff[]): boolean {
  return timeOff.some(
    (timeOffEntry) =>
      isApplicableToResource(resourceId, timeOffEntry) && isWithin(date, timeOffEntry.startDate, timeOffEntry.endDate),
  );
}

/** Whether a company closure covers this resource and date. The literal span includes weekends. */
export function isOnClosure(resource: Resource, date: ISODate, closures: Closure[]): boolean {
  return (
    !isExternalResource(resource) && closures.some((closure) => isWithin(date, closure.startDate, closure.endDate))
  );
}

interface IsUnavailableInput {
  resource: Resource;
  date: ISODate;
  timeOff: TimeOff[];
  closures: Closure[];
}

/** The single availability funnel for personal time off and company closures. */
export function isUnavailable({ resource, date, timeOff, closures }: IsUnavailableInput): boolean {
  return isOnTimeOff(resource.id, date, timeOff) || isOnClosure(resource, date, closures);
}

interface ResolveAvailableHoursForWeekdayInput {
  resource: Resource;
  date: ISODate;
  timeOff: TimeOff[];
  closures: Closure[];
  weekday: Weekday;
  effectiveWeek: EffectiveWorkingWeek;
}

/** Calculates a resource’s available hours for one weekday after time-off and closure rules. */
export function resolveAvailableHoursForWeekday({
  resource,
  date,
  timeOff,
  closures,
  weekday,
  effectiveWeek,
}: ResolveAvailableHoursForWeekdayInput): number {
  if (resource.kind === "person" && resource.firstAvailableDate && date < resource.firstAvailableDate) return 0;
  if (resource.kind === "person" && resource.lastAvailableDate && date > resource.lastAvailableDate) return 0;
  if (!effectiveWeekIncludes(effectiveWeek, weekday)) return 0;
  if (isUnavailable({ resource: resource, date: date, timeOff: timeOff, closures: closures })) return 0;
  return resolveScheduledHoursForWeekday(resource, weekday, effectiveWeek);
}

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
    resource: resource,
    date: date,
    timeOff: timeOff,
    closures: closures,
    weekday: weekdayOf(date),
    effectiveWeek: effectiveWeek,
  });
}

interface ResolveAllocatedHoursOnDayInput {
  resource: Resource;
  date: ISODate;
  allocations: Allocation[];
  effectiveWeek: EffectiveWorkingWeek;
}

/** Keep the allocation/calendar contract, but replace the top-of-file reference with an explicit requirement that hoursPerDay be finite and non-negative. */
export function resolveAllocatedHoursOnDay({
  resource,
  date,
  allocations,
  effectiveWeek,
}: ResolveAllocatedHoursOnDayInput): number {
  return resolveAllocatedHoursForWeekday({
    resource: resource,
    date: date,
    allocations: allocations,
    weekday: weekdayOf(date),
    effectiveWeek: effectiveWeek,
  });
}

interface ResolveAllocatedHoursForWeekdayInput {
  resource: Resource;
  date: ISODate;
  allocations: Allocation[];
  weekday: Weekday;
  effectiveWeek: EffectiveWorkingWeek;
}

/** Totals a resource’s allocated hours for one weekday. */
export function resolveAllocatedHoursForWeekday({
  resource,
  date,
  allocations,
  weekday,
  effectiveWeek,
}: ResolveAllocatedHoursForWeekdayInput): number {
  // Derive the working-weekday flag once per day: it's invariant across the loop, only the
  // allocation's `ignoreWeekends` varies (and isWeekendAware is parse-free), so this keeps the
  // render-time over-marker hot path off a per-allocation parseISO.
  const dayIsWorking = effectiveWeekIncludes(effectiveWeek, weekday);
  let sum = 0;
  for (const allocation of allocations) {
    if (allocation.resourceId !== resource.id || !isWithin(date, allocation.startDate, allocation.endDate)) continue;
    // `none` must stay explicit: passing [] to allocationWorksOnDay would mean calendar-day load.
    // Ignore working days bypasses both calendars; a normal allocation with no effective days
    // loads nothing anywhere.
    if (
      !hasAllocationLoadOnDay({
        effectiveWeek: effectiveWeek,
        ignoreWorkingDays: allocation.ignoreWeekends ?? undefined,
        dayIsWorking: dayIsWorking,
      })
    )
      continue;
    sum += allocation.hoursPerDay;
  }
  warnOnNonFiniteCapacity(sum);
  return sum;
}
