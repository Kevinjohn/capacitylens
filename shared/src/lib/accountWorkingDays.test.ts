import { describe, expect, it } from "vitest";
import { defaultAccountWorkingDays, normalizeAccountWorkingDays, orderedWeekdays } from "./accountWorkingDays";

describe("account working days", () => {
  it("defaults to the first five days of the configured week", () => {
    expect(defaultAccountWorkingDays(1)).toEqual([1, 2, 3, 4, 5]);
    expect(defaultAccountWorkingDays(0)).toEqual([0, 1, 2, 3, 4]);
  });

  it("repairs malformed selections while preserving a deliberate empty week", () => {
    expect(normalizeAccountWorkingDays([5, 1, 5], 1)).toEqual([1, 5]);
    expect(normalizeAccountWorkingDays([], 1)).toEqual([]);
    expect(normalizeAccountWorkingDays([1, 7], 1)).toEqual([1, 2, 3, 4, 5]);
    expect(normalizeAccountWorkingDays("weekdays", 0)).toEqual([0, 1, 2, 3, 4]);
  });

  it.each([-1, 7, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "repairs a selection containing the invalid day %s",
    (invalidDay) => {
      expect(normalizeAccountWorkingDays([0, invalidDay, 6], 1)).toEqual([1, 2, 3, 4, 5]);
      expect(normalizeAccountWorkingDays([0, invalidDay, 6], 0)).toEqual([0, 1, 2, 3, 4]);
    },
  );

  it("accepts both weekday boundaries and returns a deduplicated canonical set", () => {
    expect(normalizeAccountWorkingDays([6, 0, 3, 6, 0], 1)).toEqual([0, 3, 6]);
  });

  it("orders the same saved set from the configured week start", () => {
    expect(orderedWeekdays(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(orderedWeekdays(0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});
