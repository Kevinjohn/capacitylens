import { allocationWorksOnDay } from '@capacitylens/shared/lib/dateMath';
import { blockHoursPerDay } from '@capacitylens/shared/lib/schedulingDays';
import type { EffectiveWorkingWeek } from '@capacitylens/shared/lib/effectiveWorkingWeek';
import { FULL_DAY_HOURS } from '@capacitylens/shared/types/entities';
import type { Allocation } from '@capacitylens/shared/types/entities';

/** Add validated hourly load without losing the rounding residual of each addition.
 * The nonoverlapping components retain the exact sum of the supplied binary numbers.
 * TwoSum separates each rounded sum from its actual residual; adding zero creates no residual.
 */
export function addCapacityHours(components: readonly number[], hours: number): number[] {
  const next: number[] = [];
  let carry = hours;
  for (const component of components) {
    const sum = carry + component;
    const componentPart = sum - carry;
    const residual = carry - (sum - componentPart) + (component - componentPart);
    if (residual !== 0) next.push(residual);
    carry = sum;
  }
  if (carry !== 0 || next.length === 0) next.push(carry);
  return next;
}

/** Half an ulp bounds how far a stored double sits from the decimal that produced it, and half an
 * ulp of a non-negative double never exceeds the value × 2^-53. */
const UNIT_ROUNDOFF = 2 ** -53;

/** Compare the exact accumulated load to capacity, allowing only for the representation error of
 * the operands themselves: a decimal exact fit (five 1.6 h bookings against 8 h) is full rather
 * than over whatever the summation order, while any larger excess, however small, is over.
 * Components are the exact expansion from `addCapacityHours`; a scalar is one component.
 */
export function hasOverCapacity(allocated: number | readonly number[], available: number): boolean {
  const components = typeof allocated === 'number' ? [allocated] : allocated;
  const total = components.reduce((sum, component) => sum + component, 0);
  const excess = addCapacityHours(components, -available).reduce(
    (sum, component) => sum + component,
    0,
  );
  return excess > (Math.abs(total) + Math.abs(available)) * UNIT_ROUNDOFF;
}

// Blocks-mode hourly capacity projection using the standard full working day as its reference.
const BLOCK_PROJECTED_HOURS_PER_DAY = blockHoursPerDay(FULL_DAY_HOURS);

interface ApplyCapacityModeInput {
  allocations: Allocation[];
  blocksMode: boolean;
}

/** Blocks carry placement but no hourly load. Reuse this projection across every capacity surface. */
export function applyCapacityMode({
  allocations,
  blocksMode,
}: ApplyCapacityModeInput): Allocation[] {
  return blocksMode
    ? allocations.map((allocation) => ({
        ...allocation,
        hoursPerDay: BLOCK_PROJECTED_HOURS_PER_DAY,
      }))
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
  if (effectiveWeek.kind === 'none') return false;
  return allocationWorksOnDay(effectiveWeek.days, false, dayIsWorking);
}
