import { allocationWorksOnDay, eachDayISO, isWithin, isWorkingWeekday } from '@capacitylens/shared/lib/dateMath'
import type { Allocation, ID, ISODate, Resource, TimeOff } from '@capacitylens/shared/types/entities'

/** Blocks carry placement but no hourly load. Reuse this projection across every capacity surface. */
export function capacityAllocationsForMode(allocations: Allocation[], blocksMode: boolean): Allocation[] {
  return blocksMode
    ? allocations.map((allocation) => ({ ...allocation, hoursPerDay: 0 }))
    : allocations
}

// Capacity reflects real availability: a resource has 0 available hours on a
// non-working weekday or a time-off day, otherwise their workingHoursPerDay.
// A day is over-allocated when allocated hours exceed available hours. A normal
// (weekend-aware) allocation does NO work on the resource's non-working weekdays —
// a bar that merely SPANS Sat/Sun is not over there — so the only zero-capacity
// days that read as over are (a) a TIME-OFF day a working allocation covers (a real
// conflict) and (b) a weekend an allocation opts into via `ignoreWeekends`.
//
// PRECONDITION: every `workingHoursPerDay` / `hoursPerDay` reaching this module is a finite,
// non-negative number — guaranteed at every write boundary by integrity.ts (clampHoursPerDay /
// clampWorkingHoursPerDay) on store add/update, import remap, and server validate. A NaN/undefined
// slipping through is WORSE than a crash here: `NaN > x` is always false, so an over-allocated day
// would read as "never over" — a silently WRONG answer in a multi-tenant scheduler, not a visible
// failure. We therefore do NOT throw on this per-day × per-allocation hot path (that would swallow
// or crash in the wrong place); in DEV we WARN so corruption surfaces as a fault to investigate.
function devAssertFinite(label: string, n: number): void {
  if (import.meta.env.DEV && !Number.isFinite(n)) {
    console.warn(
      `capacity: ${label} is not a finite number (${String(n)}). Upstream validation (integrity.ts) ` +
        `should have prevented this — over/utilisation results for this resource will be wrong.`,
    )
  }
}

export function isWorkingDay(resource: Resource, date: ISODate): boolean {
  return isWorkingWeekday(date, resource.workingDays)
}

export function isOnTimeOff(resourceId: ID, date: ISODate, timeOff: TimeOff[]): boolean {
  return timeOff.some(
    (t) => t.resourceId === resourceId && isWithin(date, t.startDate, t.endDate),
  )
}

/** Available working hours for `resource` on `date`: 0 on a non-working weekday or a time-off
 *  day, otherwise their `workingHoursPerDay`.
 *  @remarks Assumes a finite, non-negative `workingHoursPerDay` (see the top-of-file precondition). */
export function availableHoursOnDay(
  resource: Resource,
  date: ISODate,
  timeOff: TimeOff[],
): number {
  if (!isWorkingDay(resource, date)) return 0
  if (isOnTimeOff(resource.id, date, timeOff)) return 0
  devAssertFinite('workingHoursPerDay', resource.workingHoursPerDay)
  return resource.workingHoursPerDay
}

/** Sum of allocated hours for `resource` on `date` across every overlapping allocation.
 *  A weekend-aware allocation (the default for a partial working week) does NO work on the
 *  resource's non-working weekdays, so a bar that merely SPANS Sat/Sun contributes 0 there —
 *  matching how the same `isWeekendAware` rule governs the bar's duration and drag. An allocation
 *  that opts into weekends (`ignoreWeekends`), or a resource with a full/empty working week, places
 *  its hours on every calendar day in `[startDate, endDate]`. Time-off days are working weekdays,
 *  so they still count (work on a holiday stays a real over-capacity conflict).
 *  @remarks Assumes each `hoursPerDay` is finite (see the top-of-file precondition) — a NaN would
 *    poison the sum and make every over/utilisation comparison read as "never over". */
export function allocatedHoursOnDay(
  resource: Resource,
  date: ISODate,
  allocations: Allocation[],
): number {
  // Derive the working-weekday flag ONCE per day: it's invariant across the loop, only the
  // allocation's `ignoreWeekends` varies (and isWeekendAware is parse-free), so this keeps the
  // render-time over-marker hot path off a per-allocation parseISO.
  const dayIsWorking = isWorkingDay(resource, date)
  let sum = 0
  for (const a of allocations) {
    if (a.resourceId !== resource.id || !isWithin(date, a.startDate, a.endDate)) continue
    // Weekend-aware allocations do no work on the resource's non-working weekdays — a bar that
    // merely SPANS Sat/Sun must not read as over. ignoreWeekends / a full working week opts in.
    if (!allocationWorksOnDay(resource.workingDays, a.ignoreWeekends, dayIsWorking)) continue
    sum += a.hoursPerDay
  }
  devAssertFinite('allocated hours sum', sum)
  return sum
}

export interface DayCapacity {
  date: ISODate
  allocated: number
  available: number
  over: boolean
}

/** Allocated vs. available hours for one resource-day, with the `over` flag (allocated > available).
 *  @remarks Assumes finite, non-negative hours (see the top-of-file precondition). */
export function dayCapacity(
  resource: Resource,
  date: ISODate,
  allocations: Allocation[],
  timeOff: TimeOff[],
): DayCapacity {
  const available = availableHoursOnDay(resource, date, timeOff)
  const allocated = allocatedHoursOnDay(resource, date, allocations)
  return { date, allocated, available, over: allocated > available }
}

export function capacityForWindow(
  resource: Resource,
  allocations: Allocation[],
  timeOff: TimeOff[],
  start: ISODate,
  end: ISODate,
  // Optional precomputed `eachDayISO(start, end)` result. buildSchedulerModel calls this (via
  // `utilization`, directly, too) once PER RESOURCE with the SAME [start, end] window — hoisting
  // the day-array build to the caller (computed once, reused across every resource) avoids
  // resources × (visibleDays + 14) redundant parseISO/format calls per model rebuild. Falls back
  // to deriving it here so every existing caller keeps working unchanged.
  precomputedDays?: ISODate[],
): DayCapacity[] {
  const days = precomputedDays ?? eachDayISO(start, end)
  return days.map((d) => dayCapacity(resource, d, allocations, timeOff))
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
  // See capacityForWindow's `precomputedDays` doc — passed straight through so the visible-window
  // day array is built once per model rebuild, not once per resource.
  precomputedDays?: ISODate[],
): number {
  let allocated = 0
  let available = 0
  for (const day of capacityForWindow(resource, allocations, timeOff, start, end, precomputedDays)) {
    if (day.available === 0) continue // not a working day — neither side counts
    allocated += day.allocated
    available += day.available
  }
  return available === 0 ? 0 : allocated / available
}

export interface CapacityAdvisory {
  overDays: number // days the proposed allocation works where existing + proposed hours exceed availability
  timeOffDays: number // days in the window the resource is on time off
}

/** Non-blocking advisory for a PROPOSED allocation of `hoursPerDay` over [start, end] (with the
 *  proposal's own `ignoreWeekends`): how many days it would push the resource over capacity, and how
 *  many fall on time off. `otherAllocations` is the resource's existing load to count against (caller
 *  excludes the allocation being edited). Shared by the modal and the drag-commit path so the rule
 *  lives in one place. Mirrors the per-day over-marker (`allocatedHoursOnDay`): it counts a day only
 *  when the proposed allocation actually WORKS it (so a weekend-aware bar merely spanning Sat/Sun
 *  isn't "over"), and an `ignoreWeekends` weekend — 0 capacity — reads as over exactly like the red
 *  cell does. Time off stays its OWN category, never folded into overDays (a holiday a working
 *  allocation covers is surfaced as "on time off for N days", not "over"), which is the one place the
 *  advisory deliberately diverges from the marker. Buckets the other allocations' hours by day ONCE
 *  (each only on the days IT works), so it's O(window + load), not O(windowDays × allocations). */
export function capacityAdvisory(
  resource: Resource,
  otherAllocations: Allocation[],
  timeOff: TimeOff[],
  start: ISODate,
  end: ISODate,
  hoursPerDay: number,
  ignoreWeekends: boolean | undefined,
): CapacityAdvisory {
  const days = eachDayISO(start, end)
  if (days.length === 0) return { overDays: 0, timeOffDays: 0 }
  // Zero-padded ISO dates compare lexicographically, so these min/max clamps are correct.
  const allocatedByDay = new Map<ISODate, number>()
  for (const a of otherAllocations) {
    const from = a.startDate > start ? a.startDate : start
    const to = a.endDate < end ? a.endDate : end
    for (const d of eachDayISO(from, to)) {
      // Count each existing allocation only on the days IT works, matching the over-marker's load.
      if (!allocationWorksOnDay(resource.workingDays, a.ignoreWeekends, isWorkingDay(resource, d))) continue
      allocatedByDay.set(d, (allocatedByDay.get(d) ?? 0) + a.hoursPerDay)
    }
  }
  let overDays = 0
  let timeOffDays = 0
  for (const day of days) {
    // Derive the weekday + time-off ONCE per day and reuse for both tallies — availableHoursOnDay
    // would otherwise re-run isWorkingDay (and isOnTimeOff) a second time on this hot path.
    const working = isWorkingDay(resource, day)
    const onTimeOff = working && isOnTimeOff(resource.id, day, timeOff)
    // Time off is its own category (counted, surfaced separately) and never folded into overDays —
    // a holiday only costs capacity on a day the resource would have worked, and it reads as "on
    // time off", not "over". `continue` so it can't also be tallied as over below.
    if (onTimeOff) { timeOffDays++; continue }
    // The proposal does no work on a day it doesn't cover (a weekend-aware bar over Sat/Sun) — skip.
    if (!allocationWorksOnDay(resource.workingDays, ignoreWeekends, working)) continue
    // Mirrors availableHoursOnDay: a non-working weekday the proposal opts into (ignoreWeekends) has
    // 0 capacity, so any proposed hours there read as over — exactly like the per-day over-marker.
    const available = working ? resource.workingHoursPerDay : 0
    if ((allocatedByDay.get(day) ?? 0) + hoursPerDay > available) overDays++
  }
  return { overDays, timeOffDays }
}

/** Over-allocated inside the window — the near-term radar. Strictly allocated > available,
 * including time-off days and non-working days explicitly opted into via `ignoreWeekends`.
 * An ordinary allocation merely spanning a weekend allocates zero there and remains non-over. */
export function overAllocatedInWindow(
  resource: Resource,
  allocations: Allocation[],
  timeOff: TimeOff[],
  start: ISODate,
  end: ISODate,
): boolean {
  return capacityForWindow(resource, allocations, timeOff, start, end).some(
    (day) => day.allocated > day.available,
  )
}
