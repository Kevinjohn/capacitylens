import { allocationWorksOnDay, eachDayISO, weekdayOf } from "@capacitylens/shared/lib/dateMath";
import { blockHoursPerDay } from "@capacitylens/shared/lib/schedulingDays";
import type { EffectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import { FULL_DAY_HOURS } from "@capacitylens/shared/types/entities";
import type { Allocation, Closure, ISODate, Resource, TimeOff } from "@capacitylens/shared/types/entities";
import { allocatedHoursForWeekday, availableHoursForWeekday } from "./capacity/availability";

export * from "./capacity/availability";
export * from "./capacity/advisory";
export * from "./capacity/advisoryCopy";

// Arithmetic-only tolerance: one nanohour is 3.6 microseconds, far below any scheduling input,
// while comfortably absorbing the few-ULP drift from summing days-mode fractional allocations.
const CAPACITY_COMPARISON_EPSILON_HOURS = 1e-9;

export function exceedsCapacity(allocated: number, available: number): boolean {
  return allocated - available > CAPACITY_COMPARISON_EPSILON_HOURS;
}

/** The hours/day a blocks-mode allocation contributes to capacity. Read from the ONE knob
 *  (`blockHoursPerDay`, schedulingDays.ts) rather than hardcoding its current 0, so making blocks
 *  carry load is a change to that fraction alone. A resource's own working day may be shorter than
 *  the standard one, but this projection has no account context — `FULL_DAY_HOURS` is the same
 *  reference day the fraction is documented against. */
const BLOCK_PROJECTED_HOURS_PER_DAY = blockHoursPerDay(FULL_DAY_HOURS);

/** Blocks carry placement but no hourly load. Reuse this projection across every capacity surface. */
export function capacityAllocationsForMode(allocations: Allocation[], blocksMode: boolean): Allocation[] {
  return blocksMode
    ? allocations.map((allocation) => ({ ...allocation, hoursPerDay: BLOCK_PROJECTED_HOURS_PER_DAY }))
    : allocations;
}

// Capacity reflects the effective company/personal working pattern: a resource has 0 available
// hours on a non-working weekday or time-off day, 4 hours on a half day, and 8 hours on a full day.
// A day is over-allocated when allocated hours exceed available hours. A normal
// (weekend-aware) allocation does NO work on the effective week's non-working weekdays —
// a bar that merely SPANS Sat/Sun is not over there — so the only zero-capacity
// days that read as over are (a) a TIME-OFF day a working allocation covers (a real
// conflict) and (b) a weekend an allocation opts into via `ignoreWeekends`.
//
// PRECONDITION: every `hoursPerDay` reaching this module is a finite, non-negative number —
// guaranteed at every write boundary by integrity.ts (clampHoursPerDay) on store add/update,
// import remap, and server validate. A NaN/undefined
// slipping through is WORSE than a crash here: `NaN > x` is always false, so an over-allocated day
// would read as "never over" — a silently WRONG answer in a multi-tenant scheduler, not a visible
// failure. We therefore do NOT throw on this per-day × per-allocation hot path (that would swallow
// or crash in the wrong place); in DEV we WARN so corruption surfaces as a fault to investigate.
export function devAssertFinite(n: number): void {
  if (import.meta.env.DEV && !Number.isFinite(n)) {
    console.warn(
      `capacity: allocated hours sum is not a finite number (${String(n)}). Upstream validation ` +
        `(integrity.ts) should have prevented this — over/utilisation results for this resource will be wrong.`,
    );
  }
}

// Every public helper below takes an `ISODate` and derives its weekday; each `…ForWeekday` twin
// takes one already derived. `weekdayOf` is a parseISO, and `dayCapacity` — the scheduler's hottest
// path, ~27k resource-days per model rebuild — needs the SAME weekday four times over. It derives
// it ONCE and threads it through the twins; the public signatures stay date-only.
/** Whether an allocation loads this date. Keep `none` explicit: an empty weekday array has
 * calendar-day semantics in allocationWorksOnDay, which is the opposite of the capacity contract. */
export function allocationLoadsOnDay(
  effectiveWeek: EffectiveWorkingWeek,
  ignoreWorkingDays: boolean | undefined,
  dayIsWorking: boolean,
): boolean {
  if (ignoreWorkingDays) return true;
  if (effectiveWeek.kind === "none") return false;
  return allocationWorksOnDay(effectiveWeek.days, false, dayIsWorking);
}

export interface DayCapacity {
  date: ISODate;
  allocated: number;
  available: number;
  over: boolean;
}

/** Allocated vs. available hours for one resource-day, with the `over` flag (allocated > available).
 *  @remarks Assumes finite, non-negative hours (see the top-of-file precondition). */
export function dayCapacity(
  resource: Resource,
  date: ISODate,
  allocations: Allocation[],
  timeOff: TimeOff[],
  effectiveWeek: EffectiveWorkingWeek,
  closures: Closure[],
): DayCapacity {
  // ONE parseISO for the whole resource-day: the availability and load halves each need the
  // weekday (twice over, for the working-week and half-day tests), and this runs per resource ×
  // per visible day on every model rebuild.
  const weekday = weekdayOf(date);
  const available = availableHoursForWeekday(resource, date, timeOff, closures, weekday, effectiveWeek);
  const allocated = allocatedHoursForWeekday(resource, date, allocations, weekday, effectiveWeek);
  return {
    date,
    allocated,
    available,
    over: exceedsCapacity(allocated, available),
  };
}

/** Whole-window capacity, one entry per calendar day, derived straight from the inputs.
 *  The render path does NOT come through here: buildSchedulerModel walks the SAME window for every
 *  resource, so it builds the day array once, buckets each resource's allocations and time off by
 *  covered date (`bucketByCoveredDate`), and memoises `dayCapacity` per date. This stays the
 *  straight-line definition those optimisations are checked against. */
export function capacityForWindow(
  resource: Resource,
  allocations: Allocation[],
  timeOff: TimeOff[],
  start: ISODate,
  end: ISODate,
  effectiveWeek: EffectiveWorkingWeek,
  closures: Closure[],
): DayCapacity[] {
  return eachDayISO(start, end).map((d) => dayCapacity(resource, d, allocations, timeOff, effectiveWeek, closures));
}

/** Reduce already-computed resource-day capacity into the visible-window utilisation ratio. */
export function utilizationFromCapacity(days: Iterable<DayCapacity>): number {
  let allocated = 0;
  let available = 0;
  for (const day of days) {
    if (day.available === 0) continue; // not a working day — neither side counts
    allocated += day.allocated;
    available += day.available;
  }
  return available === 0 ? 0 : allocated / available;
}

/** Allocated / available over the window, counted over working days only.
 *  Returns 0 when there is no availability. Non-working days (weekends / time off)
 *  are skipped entirely — counting their allocated hours against zero availability
 *  would push a normal allocation that merely spans a weekend past 100%.
 *  Like `capacityForWindow`, this is the straight-line definition; the render path reaches the same
 *  number through `utilizationFromCapacity` over its memoised per-date capacity. */
export function utilization(
  resource: Resource,
  allocations: Allocation[],
  timeOff: TimeOff[],
  start: ISODate,
  end: ISODate,
  effectiveWeek: EffectiveWorkingWeek,
  closures: Closure[],
): number {
  return utilizationFromCapacity(
    capacityForWindow(resource, allocations, timeOff, start, end, effectiveWeek, closures),
  );
}
