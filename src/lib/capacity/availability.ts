import { isWithin, weekdayOf } from "@capacitylens/shared/lib/dateMath";
import { effectiveWeekIncludes, type EffectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import {
  FULL_DAY_HOURS,
  HALF_DAY_HOURS,
  hasPersonalWorkingPattern,
  isExternalResource,
} from "@capacitylens/shared/types/entities";
import type { Allocation, Closure, ID, ISODate, Resource, TimeOff, Weekday } from "@capacitylens/shared/types/entities";
import { allocationLoadsOnDay, devAssertFinite } from "../capacity";

export function isWorkingDay(effectiveWeek: EffectiveWorkingWeek, date: ISODate): boolean {
  return effectiveWeekIncludes(effectiveWeek, weekdayOf(date));
}

/** A saved half-day working pattern on this weekday — 4h of capacity instead of 8h. The scheduler's
 *  partial-capacity tint asks the same question, so both read this one definition. */
export function isHalfDay(resource: Resource, weekday: Weekday): boolean {
  return hasPersonalWorkingPattern(resource) && resource.halfDays.includes(weekday);
}

export function scheduledHoursForWeekday(
  resource: Resource,
  weekday: Weekday,
  effectiveWeek: EffectiveWorkingWeek,
): number {
  if (!effectiveWeekIncludes(effectiveWeek, weekday)) return 0;
  return isHalfDay(resource, weekday) ? HALF_DAY_HOURS : FULL_DAY_HOURS;
}

/** Fixed capacity before time off: 8h full day, 4h half day, or 0 when not working. */
export function scheduledHoursOnDay(resource: Resource, date: ISODate, effectiveWeek: EffectiveWorkingWeek): number {
  return scheduledHoursForWeekday(resource, weekdayOf(date), effectiveWeek);
}

/** THE applies-to-this-resource rule for personal time off. */
function appliesTo(resourceId: ID, t: TimeOff): boolean {
  return t.resourceId === resourceId;
}

/** The personal time-off entries that apply to this resource. */
export function timeOffApplyingTo(resourceId: ID, timeOff: TimeOff[]): TimeOff[] {
  return timeOff.filter((t) => appliesTo(resourceId, t));
}

export function isOnTimeOff(resourceId: ID, date: ISODate, timeOff: TimeOff[]): boolean {
  return timeOff.some((t) => appliesTo(resourceId, t) && isWithin(date, t.startDate, t.endDate));
}

/** Whether a company closure covers this resource and date. The literal span includes weekends. */
export function isOnClosure(resource: Resource, date: ISODate, closures: Closure[]): boolean {
  return (
    !isExternalResource(resource) && closures.some((closure) => isWithin(date, closure.startDate, closure.endDate))
  );
}

/** The single availability funnel for personal time off and company closures. */
export function isUnavailable(resource: Resource, date: ISODate, timeOff: TimeOff[], closures: Closure[]): boolean {
  return isOnTimeOff(resource.id, date, timeOff) || isOnClosure(resource, date, closures);
}

export function availableHoursForWeekday(
  resource: Resource,
  date: ISODate,
  timeOff: TimeOff[],
  closures: Closure[],
  weekday: Weekday,
  effectiveWeek: EffectiveWorkingWeek,
): number {
  if (!effectiveWeekIncludes(effectiveWeek, weekday)) return 0;
  if (isUnavailable(resource, date, timeOff, closures)) return 0;
  return scheduledHoursForWeekday(resource, weekday, effectiveWeek);
}

/** Available working hours for `resource` on `date`: 0 on a non-working weekday or time off,
 *  fixed 4h on a half day, otherwise fixed 8h. */
export function availableHoursOnDay(
  resource: Resource,
  date: ISODate,
  timeOff: TimeOff[],
  effectiveWeek: EffectiveWorkingWeek,
  closures: Closure[],
): number {
  return availableHoursForWeekday(resource, date, timeOff, closures, weekdayOf(date), effectiveWeek);
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
export function allocatedHoursOnDay(
  resource: Resource,
  date: ISODate,
  allocations: Allocation[],
  effectiveWeek: EffectiveWorkingWeek,
): number {
  return allocatedHoursForWeekday(resource, date, allocations, weekdayOf(date), effectiveWeek);
}

export function allocatedHoursForWeekday(
  resource: Resource,
  date: ISODate,
  allocations: Allocation[],
  weekday: Weekday,
  effectiveWeek: EffectiveWorkingWeek,
): number {
  // Derive the working-weekday flag ONCE per day: it's invariant across the loop, only the
  // allocation's `ignoreWeekends` varies (and isWeekendAware is parse-free), so this keeps the
  // render-time over-marker hot path off a per-allocation parseISO.
  const dayIsWorking = effectiveWeekIncludes(effectiveWeek, weekday);
  let sum = 0;
  for (const a of allocations) {
    if (a.resourceId !== resource.id || !isWithin(date, a.startDate, a.endDate)) continue;
    // `none` must stay explicit: passing [] to allocationWorksOnDay would mean calendar-day load.
    // Ignore working days bypasses both calendars; a normal allocation with no effective days
    // loads nothing anywhere.
    if (!allocationLoadsOnDay(effectiveWeek, a.ignoreWeekends, dayIsWorking)) continue;
    sum += a.hoursPerDay;
  }
  devAssertFinite(sum);
  return sum;
}
