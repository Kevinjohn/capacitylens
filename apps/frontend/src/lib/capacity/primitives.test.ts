import { expect, it } from "vitest";
import { addCapacityHours, hasOverCapacity } from "./primitives";
it("recognises a real excess smaller than a nanohour", () => {
  expect(hasOverCapacity(8 + 1e-10, 8)).toBe(true);
});
it("corrects actual fractional addition noise rather than inferring decimal intent", () => {
  const components = [16 / 9, 40 / 9, 16 / 9].reduce(addCapacityHours, [] as number[]);
  expect(hasOverCapacity(components, 8)).toBe(false);
  expect(hasOverCapacity(0.1 + 0.2, 0.3)).toBe(true);
});

it("preserves ordinary equality, zero-capacity and clear excess comparisons", () => {
  expect(hasOverCapacity(8, 8)).toBe(false);
  expect(hasOverCapacity(0, 0)).toBe(false);
  expect(hasOverCapacity(1e-20, 0)).toBe(true);
  expect(hasOverCapacity(8.01, 8)).toBe(true);
});

it("preserves a noise-free representable single-term overload", () => {
  expect(hasOverCapacity(8 + 2 ** -49, 8)).toBe(true);
});

it("preserves tiny positive residuals and does not change an exact sum when zeros are added", () => {
  for (const excess of [2 ** -49, 1e-20, Number.MIN_VALUE]) {
    const load = [8, excess, ...Array<number>(100).fill(0)].reduce(addCapacityHours, [] as number[]);
    expect(hasOverCapacity(load, 8)).toBe(true);
  }
  expect(hasOverCapacity([8, ...Array<number>(100).fill(0)].reduce(addCapacityHours, [] as number[]), 8)).toBe(false);
});
