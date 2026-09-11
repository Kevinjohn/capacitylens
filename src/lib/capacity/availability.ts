import { isWithin, weekdayOf } from "@capacitylens/shared/lib/dateMath";
import { effectiveWeekIncludes, type EffectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import {
  FULL_DAY_HOURS,
  HALF_DAY_HOURS,
  hasPersonalWorkingPattern,
  isExternalResource,
} from "@capacitylens/shared/types/entities";
import type { Allocation, Closure, ID, ISODate, Resource, TimeOff, Weekday } from "@capacitylens/shared/types/entities";
import { hasAllocationLoadOnDay, warnOnNonFiniteCapacity } from "./primitives";

export function isWorkingDay(effectiveWeek: EffectiveWorkingWeek, date: ISODate): boolean {
  return effectiveWeekIncludes(effectiveWeek, weekdayOf(date));
}

/** A saved half-day working pattern on this weekday — 4h of capacity instead of 8h. The scheduler's
 *  partial-capacity tint asks the same question, so both read this one definition. */
export function isHalfDay(resource: Resource, weekday: Weekday): boolean {
  return hasPersonalWorkingPattern(resource) && resource.halfDays.includes(weekday);
}

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

/** THE applies-to-this-resource rule for personal time off. */
function isApplicableToResource(resourceId: ID, timeOffEntry: TimeOff): boolean {
  return timeOffEntry.resourceId === resourceId;
}

/** The personal time-off entries that apply to this resource. */
export function listTimeOffApplyingTo(resourceId: ID, timeOff: TimeOff[]): TimeOff[] {
  return timeOff.filter((timeOffEntry) => isApplicableToResource(resourceId, timeOffEntry));
}

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
 *  fixed 4h on a half day, otherwise fixed 8h. */
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

/** Sum of allocated hours for `resource` on `date` across every overlapping allocation.
 *  A weekend-aware allocation (the default for a partial working week) does NO work on the
 *  effective week's non-working weekdays, so a bar that merely SPANS Sat/Sun contributes 0 there —
 *  matching how the same `isWeekendAware` rule governs the bar's duration and drag. An allocation
 *  that ignores the working calendars (`ignoreWeekends`) places its hours on every calendar day in
 *  `[startDate, endDate]`. A normal allocation with no effective week loads no days. Time-off days
 *  that remain effective weekdays still load, preserving the real over-capacity conflict.
 *  @remarks Assumes each `hoursPerDay` is finite (see the top-of-file precondition) — a NaN would
 *    poison the sum and make every over/utilisation comparison read as "never over". */
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

export function resolveAllocatedHoursForWeekday({
  resource,
  date,
  allocations,
  weekday,
  effectiveWeek,
}: ResolveAllocatedHoursForWeekdayInput): number {
  // Derive the working-weekday flag ONCE per day: it's invariant across the loop, only the
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
        ignoreWorkingDays: allocation.ignoreWeekends,
        dayIsWorking: dayIsWorking,
      })
    )
      continue;
    sum += allocation.hoursPerDay;
  }
  warnOnNonFiniteCapacity(sum);
  return sum;
}
