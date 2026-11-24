import { isWithin, getWeekday } from '../dateMath.js';
import { hasEffectiveWeekDay } from '../effectiveWorkingWeek.js';
import type { EffectiveWorkingWeek } from '../effectiveWorkingWeek.js';
import {
  FULL_DAY_HOURS,
  HALF_DAY_HOURS,
  hasPersonalWorkingPattern,
  isExternalResource,
} from '../../types/entities.js';
import type {
  Allocation,
  Closure,
  ID,
  ISODate,
  Resource,
  TimeOff,
  Weekday,
} from '../../types/entities.js';
import { addCapacityHours, hasAllocationLoadOnDay, warnOnNonFiniteCapacity } from './primitives.js';

/** Checks whether a date belongs to the effective working week. */
export function isWorkingDay(effectiveWeek: EffectiveWorkingWeek, date: ISODate): boolean {
  return hasEffectiveWeekDay(effectiveWeek, getWeekday(date));
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
  if (!hasEffectiveWeekDay(effectiveWeek, weekday)) return 0;
  return isHalfDay(resource, weekday) ? HALF_DAY_HOURS : FULL_DAY_HOURS;
}

/** Fixed capacity before time off: 8h full day, 4h half day, or 0 when not working. */
export function resolveScheduledHoursOnDay(
  resource: Resource,
  date: ISODate,
  effectiveWeek: EffectiveWorkingWeek,
): number {
  if (
    resource.kind === 'person' &&
    resource.firstAvailableDate &&
    date < resource.firstAvailableDate
  ) {
    return 0;
  }
  if (
    resource.kind === 'person' &&
    resource.lastAvailableDate &&
    date > resource.lastAvailableDate
  ) {
    return 0;
  }
  return resolveScheduledHoursForWeekday(resource, getWeekday(date), effectiveWeek);
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
      isApplicableToResource(resourceId, timeOffEntry) &&
      isWithin(date, timeOffEntry.startDate, timeOffEntry.endDate),
  );
}

/** Whether a company closure covers this resource and date. The literal span includes weekends. */
export function isOnClosure(resource: Resource, date: ISODate, closures: Closure[]): boolean {
  return (
    !isExternalResource(resource) &&
    closures.some((closure) => isWithin(date, closure.startDate, closure.endDate))
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
  if (
    resource.kind === 'person' &&
    resource.firstAvailableDate &&
    date < resource.firstAvailableDate
  ) {
    return 0;
  }
  if (
    resource.kind === 'person' &&
    resource.lastAvailableDate &&
    date > resource.lastAvailableDate
  ) {
    return 0;
  }
  if (!hasEffectiveWeekDay(effectiveWeek, weekday)) return 0;
  if (isUnavailable({ resource, date, timeOff, closures })) {
    return 0;
  }
  return resolveScheduledHoursForWeekday(resource, weekday, effectiveWeek);
}

interface ResolveAllocatedHoursForWeekdayInput {
  resource: Resource;
  date: ISODate;
  allocations: Allocation[];
  weekday: Weekday;
  effectiveWeek: EffectiveWorkingWeek;
}

/** Totals a resource’s allocated hours for one weekday. */
export function resolveAllocationLoadForWeekday({
  resource,
  date,
  allocations,
  weekday,
  effectiveWeek,
}: ResolveAllocatedHoursForWeekdayInput): { hours: number; components: readonly number[] } {
  // Derive the working-weekday flag once per day: it's invariant across the loop, only the
  // allocation's `ignoreWorkingDays` varies (and isWeekendAware is parse-free), so this keeps the
  // render-time over-marker hot path off a per-allocation parseISO.
  const dayIsWorking = hasEffectiveWeekDay(effectiveWeek, weekday);
  let sum = 0;
  let components: number[] = [];
  for (const allocation of allocations) {
    if (
      allocation.resourceId !== resource.id ||
      !isWithin(date, allocation.startDate, allocation.endDate)
    ) {
      continue;
    }
    // `none` must stay explicit: passing [] to canAllocationWorkOnDay would mean calendar-day load.
    // Ignore working days bypasses both calendars; a normal allocation with no effective days
    // loads nothing anywhere.
    if (
      !hasAllocationLoadOnDay({
        effectiveWeek,
        ignoreWorkingDays: allocation.ignoreWorkingDays ?? undefined,
        dayIsWorking,
      })
    ) {
      continue;
    }
    const hoursPerDay = allocation.hoursPerDay;
    sum += hoursPerDay;
    components = addCapacityHours(components, hoursPerDay);
  }
  warnOnNonFiniteCapacity(sum);
  return { hours: sum, components };
}

/** Allocated hours for one resource-day; the detailed traversal also retains exact comparison components. */
export function resolveAllocatedHoursForWeekday(
  input: ResolveAllocatedHoursForWeekdayInput,
): number {
  return resolveAllocationLoadForWeekday(input).hours;
}
