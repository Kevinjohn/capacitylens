import { expect, it } from 'vitest';
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
