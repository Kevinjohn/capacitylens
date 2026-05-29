import { eachDayISO, isWithin, weekdayOf } from './dateMath'
import type { Allocation, ID, ISODate, Resource, TimeOff } from '../types/entities'

// Capacity reflects real availability: a resource has 0 available hours on a
// non-working weekday or a time-off day, otherwise their workingHoursPerDay.
// A day is over-allocated when allocated hours exceed available hours (which
// includes any allocation landing on a zero-capacity day).

export function isWorkingDay(resource: Resource, date: ISODate): boolean {
  return resource.workingDays.includes(weekdayOf(date))
}

export function isOnTimeOff(resourceId: ID, date: ISODate, timeOff: TimeOff[]): boolean {
  return timeOff.some(
    (t) => t.resourceId === resourceId && isWithin(date, t.startDate, t.endDate),
  )
}

export function availableHoursOnDay(
  resource: Resource,
  date: ISODate,
  timeOff: TimeOff[],
): number {
  if (!isWorkingDay(resource, date)) return 0
  if (isOnTimeOff(resource.id, date, timeOff)) return 0
  return resource.workingHoursPerDay
}

export function allocatedHoursOnDay(
  resourceId: ID,
  date: ISODate,
  allocations: Allocation[],
): number {
  let sum = 0
  for (const a of allocations) {
    if (a.resourceId === resourceId && isWithin(date, a.startDate, a.endDate)) {
      sum += a.hoursPerDay
    }
  }
  return sum
}

export interface DayCapacity {
  date: ISODate
  allocated: number
  available: number
  over: boolean
}

export function dayCapacity(
  resource: Resource,
  date: ISODate,
  allocations: Allocation[],
  timeOff: TimeOff[],
): DayCapacity {
  const available = availableHoursOnDay(resource, date, timeOff)
  const allocated = allocatedHoursOnDay(resource.id, date, allocations)
  return { date, allocated, available, over: allocated > available }
}

export function capacityForWindow(
  resource: Resource,
  allocations: Allocation[],
  timeOff: TimeOff[],
  start: ISODate,
  end: ISODate,
): DayCapacity[] {
  return eachDayISO(start, end).map((d) => dayCapacity(resource, d, allocations, timeOff))
}

/** Allocated / available over the window. Returns 0 when there is no availability. */
export function utilization(
  resource: Resource,
  allocations: Allocation[],
  timeOff: TimeOff[],
  start: ISODate,
  end: ISODate,
): number {
  let allocated = 0
  let available = 0
  for (const day of capacityForWindow(resource, allocations, timeOff, start, end)) {
    allocated += day.allocated
    available += day.available
  }
  return available === 0 ? 0 : allocated / available
}
