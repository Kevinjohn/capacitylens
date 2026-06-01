import { eachDayISO, isWithin, weekdayOf } from '@floaty/shared/lib/dateMath'
import type { Allocation, ID, ISODate, Resource, TimeOff } from '@floaty/shared/types/entities'

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

/** Allocated / available over the window, counted over working days only.
 *  Returns 0 when there is no availability. Non-working days (weekends / time off)
 *  are skipped entirely — counting their allocated hours against zero availability
 *  would push a normal allocation that merely spans a weekend past 100%. */
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
    if (day.available === 0) continue // not a working day — neither side counts
    allocated += day.allocated
    available += day.available
  }
  return available === 0 ? 0 : allocated / available
}

export interface CapacityAdvisory {
  overDays: number // working days in the window where existing + proposed hours exceed availability
  timeOffDays: number // days in the window the resource is on time off
}

/** Non-blocking advisory for a PROPOSED allocation of `hoursPerDay` over [start, end]:
 *  how many working days it would push the resource over capacity, and how many fall on
 *  time off. `otherAllocations` is the resource's existing load to count against (caller
 *  excludes the allocation being edited). Shared by the modal and the drag-commit path so
 *  the rule lives in one place. Buckets the other allocations' hours by day ONCE (clamped
 *  to the window) so it's O(window + load), not O(windowDays × allocations). */
export function capacityAdvisory(
  resource: Resource,
  otherAllocations: Allocation[],
  timeOff: TimeOff[],
  start: ISODate,
  end: ISODate,
  hoursPerDay: number,
): CapacityAdvisory {
  const days = eachDayISO(start, end)
  if (days.length === 0) return { overDays: 0, timeOffDays: 0 }
  // Zero-padded ISO dates compare lexicographically, so these min/max clamps are correct.
  const allocatedByDay = new Map<ISODate, number>()
  for (const a of otherAllocations) {
    const from = a.startDate > start ? a.startDate : start
    const to = a.endDate < end ? a.endDate : end
    for (const d of eachDayISO(from, to)) allocatedByDay.set(d, (allocatedByDay.get(d) ?? 0) + a.hoursPerDay)
  }
  let overDays = 0
  let timeOffDays = 0
  for (const day of days) {
    // Derive the weekday + time-off ONCE per day and reuse for both tallies — availableHoursOnDay
    // would otherwise re-run isWorkingDay (and isOnTimeOff) a second time on this hot path.
    const working = isWorkingDay(resource, day)
    const onTimeOff = working && isOnTimeOff(resource.id, day, timeOff)
    // Only count time off on days the resource would actually have worked — a holiday on a
    // non-working weekend costs no capacity (matches overDays below, which skips zero-capacity days).
    if (onTimeOff) timeOffDays++
    // Mirrors availableHoursOnDay: weekend / time off → 0, else the working-hours/day.
    const available = working && !onTimeOff ? resource.workingHoursPerDay : 0
    if (available > 0 && (allocatedByDay.get(day) ?? 0) + hoursPerDay > available) overDays++
  }
  return { overDays, timeOffDays }
}

/** Over-allocated on a working day inside the window — the near-term "overbooked"
 *  radar. Unlike the per-day over-marker (which flags ANY allocation on a
 *  zero-capacity day), this ignores weekend/time-off days so an ordinary
 *  allocation spanning them doesn't read as overbooked. */
export function overAllocatedInWindow(
  resource: Resource,
  allocations: Allocation[],
  timeOff: TimeOff[],
  start: ISODate,
  end: ISODate,
): boolean {
  return capacityForWindow(resource, allocations, timeOff, start, end).some(
    (day) => day.available > 0 && day.allocated > day.available,
  )
}
