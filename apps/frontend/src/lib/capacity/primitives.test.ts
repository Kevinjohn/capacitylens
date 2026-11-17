import { describe, it, expect, vi } from 'vitest';
import { applyCapacityMode } from '@/lib/capacity';
import {
  availableHoursOnDay,
  allocatedHoursOnDay,
  makeResource,
  makeAlloc,
} from '@/test/capacityTestSupport';
import { addCapacityHours, hasOverCapacity } from './primitives';

const expansion = (hours: readonly number[]) => hours.reduce(addCapacityHours, [] as number[]);

it('recognises a real excess smaller than a nanohour', () => {
  expect(hasOverCapacity(8 + 1e-10, 8)).toBe(true);
  expect(hasOverCapacity(expansion([1.6, 1.6, 1.6, 1.6, 1.6, 1e-10]), 8)).toBe(true);
  expect(hasOverCapacity(expansion([8, 1e-13, ...Array<number>(100).fill(0)]), 8)).toBe(true);
});

it('treats a decimal exact fit as full, not over, whatever the summation order', () => {
  // Days-mode bookings store 8 × days / span, so these are everyday operands, not edge cases.
  expect(hasOverCapacity(expansion([1.6, 1.6, 1.6, 1.6, 1.6]), 8)).toBe(false);
  expect(hasOverCapacity(expansion(Array<number>(10).fill(0.8)), 8)).toBe(false);
  expect(hasOverCapacity(expansion([1.1, 6.9]), 8)).toBe(false);
  expect(hasOverCapacity(expansion([6.9, 1.1]), 8)).toBe(false);
  expect(hasOverCapacity(expansion([16 / 9, 40 / 9, 16 / 9]), 8)).toBe(false);
  expect(hasOverCapacity(0.1 + 0.2, 0.3)).toBe(false);
  expect(hasOverCapacity(expansion([1.6, 1.6, 1.6, 1.6, 1.6]), 7.5)).toBe(true);
});

it('preserves ordinary equality, zero-capacity and clear excess comparisons', () => {
  expect(hasOverCapacity(8, 8)).toBe(false);
  expect(hasOverCapacity(0, 0)).toBe(false);
  expect(hasOverCapacity(1e-20, 0)).toBe(true);
  expect(hasOverCapacity(8.01, 8)).toBe(true);
});

it("ignores an excess within the operands' own representation error, with or without zero terms", () => {
  // One ulp above 8 is what rounding a decimal product can leave behind, not a booking.
  expect(hasOverCapacity(8 + 2 ** -49, 8)).toBe(false);
  for (const excess of [2 ** -49, 1e-20, Number.MIN_VALUE]) {
    expect(hasOverCapacity(expansion([8, excess, ...Array<number>(100).fill(0)]), 8)).toBe(false);
  }
  expect(hasOverCapacity(expansion([8, ...Array<number>(100).fill(0)]), 8)).toBe(false);
});

describe('capacityAllocationsForMode', () => {
  it('preserves hourly allocations and projects blocks to zero load without mutating input', () => {
    const allocations = [makeAlloc({ hoursPerDay: 7 })];
    expect(applyCapacityMode({ allocations: allocations, blocksMode: false })).toBe(allocations);
    const blocks = applyCapacityMode({ allocations: allocations, blocksMode: true });
    expect(blocks).toEqual([{ ...allocations[0], hoursPerDay: 0 }]);
    expect(allocations[0]?.hoursPerDay).toBe(7);
  });
});

describe('devAssertFinite (DEV-only console.warn on a non-finite allocation)', () => {
  const r = makeResource();

  it('ignores a legacy non-finite workingHoursPerDay because full-day capacity is fixed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    availableHoursOnDay({
      resource: makeResource({ workingHoursPerDay: Number.NaN }),
      date: '2026-06-01',
      timeOff: [],
    });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('warns with the "allocated hours sum" label when the summed allocation hours are not finite', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const allocs = [
      makeAlloc({
        startDate: '2026-06-01',
        endDate: '2026-06-01',
        hoursPerDay: Number.NaN,
      }),
    ];
    allocatedHoursOnDay({ resource: r, date: '2026-06-01', allocations: allocs });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('allocated hours sum');
    warn.mockRestore();
  });
});
