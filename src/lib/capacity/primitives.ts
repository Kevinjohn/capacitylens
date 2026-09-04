import { allocationWorksOnDay } from "@capacitylens/shared/lib/dateMath";
import { blockHoursPerDay } from "@capacitylens/shared/lib/schedulingDays";
import type { EffectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import { FULL_DAY_HOURS, type Allocation } from "@capacitylens/shared/types/entities";

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
