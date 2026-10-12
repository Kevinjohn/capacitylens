import { allocationWorksOnDay } from "@capacitylens/shared/lib/dateMath";
import { blockHoursPerDay } from "@capacitylens/shared/lib/schedulingDays";
import type { EffectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import { FULL_DAY_HOURS } from "@capacitylens/shared/types/entities";
import type { Allocation } from "@capacitylens/shared/types/entities";

// Arithmetic-only tolerance: one nanohour is 3.6 microseconds, far below any scheduling input,
// while comfortably absorbing the few-ULP drift from summing days-mode fractional allocations.
const CAPACITY_COMPARISON_EPSILON_HOURS = 1e-9;

/** Checks whether allocated hours exceed available capacity beyond numeric tolerance. */
export function hasOverCapacity(allocated: number, available: number): boolean {
  return allocated - available > CAPACITY_COMPARISON_EPSILON_HOURS;
}

// Blocks-mode hourly capacity projection using the standard full working day as its reference.
const BLOCK_PROJECTED_HOURS_PER_DAY = blockHoursPerDay(FULL_DAY_HOURS);

interface ApplyCapacityModeInput {
  allocations: Allocation[];
  blocksMode: boolean;
}

/** Blocks carry placement but no hourly load. Reuse this projection across every capacity surface. */
export function applyCapacityMode({ allocations, blocksMode }: ApplyCapacityModeInput): Allocation[] {
  return blocksMode
    ? allocations.map((allocation) => ({ ...allocation, hoursPerDay: BLOCK_PROJECTED_HOURS_PER_DAY }))
    : allocations;
}

// Capacity arithmetic requires finite, non-negative hours validated at write boundaries.
// Warn in development rather than wrap each hot-path calculation; NaN would otherwise
// make conflict comparisons silently false. Effective weekdays govern ordinary load,
// while ignoreWeekends may place work on zero-capacity days.
/** Warns during development when a capacity calculation is not finite. */
export function warnOnNonFiniteCapacity(hours: number): void {
  if (import.meta.env.DEV && !Number.isFinite(hours)) {
    console.warn(
      `capacity: allocated hours sum is not a finite number (${String(hours)}). Upstream validation ` +
        `(integrity.ts) should have prevented this — over/utilisation results for this resource will be wrong.`,
    );
  }
}

interface HasAllocationLoadOnDayInput {
  effectiveWeek: EffectiveWorkingWeek;
  ignoreWorkingDays: boolean | undefined;
  dayIsWorking: boolean;
}

// Derive weekdays once per resource-day and pass them to weekday-aware helpers so
// capacity checks avoid repeated date parsing on the model rebuild path.
/** Whether an allocation loads this date. Keep `none` explicit: an empty weekday array has
 * calendar-day semantics in allocationWorksOnDay, which is the opposite of the capacity contract. */
export function hasAllocationLoadOnDay({
  effectiveWeek,
  ignoreWorkingDays,
  dayIsWorking,
}: HasAllocationLoadOnDayInput): boolean {
  if (ignoreWorkingDays) return true;
  if (effectiveWeek.kind === "none") return false;
  return allocationWorksOnDay(effectiveWeek.days, false, dayIsWorking);
}
