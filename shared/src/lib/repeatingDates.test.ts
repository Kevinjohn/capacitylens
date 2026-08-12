import { describe, expect, it } from "vitest";
import { weekdayOf } from "./dateMath";
import {
  GENERATED_ALLOCATION_LIMIT,
  generateRepeatingStartDates,
  maximumRepeatUntilDate,
  RepeatingDateError,
} from "./repeatingDates";

describe("generateRepeatingStartDates weekly", () => {
  it.each([
    [1, 14],
    [2, 7],
    [3, 5],
    [4, 4],
  ] as const)("includes the anchor and generates a %s-week cadence", (interval, count) => {
    const result = generateRepeatingStartDates("2026-04-01", "2026-07-01", { kind: "weeks", interval });
    expect(result.repeatUntil).toBe("2026-07-01");
    expect(result.startDates).toHaveLength(count);
    expect(result.startDates[0]).toBe("2026-04-01");
    expect(result.startDates.every((date) => weekdayOf(date) === weekdayOf("2026-04-01"))).toBe(true);
    expect(result.startDates.every((date, index, dates) => index === 0 || date > dates[index - 1])).toBe(true);
  });

  it("includes a candidate exactly on the window end and excludes the next", () => {
    const result = generateRepeatingStartDates("2026-04-01", "2026-07-01", { kind: "weeks", interval: 1 });
    expect(result.startDates.at(-1)).toBe("2026-07-01");
    expect(result.startDates).not.toContain("2026-07-08");
  });

  it("crosses month/year and leap-day boundaries without changing weekday", () => {
    const year = generateRepeatingStartDates("2026-11-30", "2027-02-28", { kind: "weeks", interval: 2 });
    const leap = generateRepeatingStartDates("2028-02-29", "2028-05-29", { kind: "weeks", interval: 1 });
    expect(year.startDates).toContain("2027-01-11");
    expect(leap.repeatUntil).toBe("2028-05-29");
    expect(leap.startDates.every((date) => weekdayOf(date) === weekdayOf("2028-02-29"))).toBe(true);
  });

  it("supports a weekly six-month cutoff below the defensive allocation limit", () => {
    for (const interval of [1, 2, 3, 4] as const) {
      expect(
        generateRepeatingStartDates("2028-01-01", "2028-07-01", { kind: "weeks", interval }).startDates.length,
      ).toBeLessThanOrEqual(GENERATED_ALLOCATION_LIMIT);
    }
    expect(
      generateRepeatingStartDates("2028-01-01", "2028-07-01", { kind: "weeks", interval: 1 }).startDates,
    ).toHaveLength(27);
  });
});

describe("generateRepeatingStartDates monthly", () => {
  it.each([
    ["2026-01-13", ["2026-01-13", "2026-02-13", "2026-03-13", "2026-04-13"]],
    ["2027-01-29", ["2027-01-29", "2027-02-28", "2027-03-29", "2027-04-29"]],
    ["2028-01-29", ["2028-01-29", "2028-02-29", "2028-03-29", "2028-04-29"]],
    ["2027-01-30", ["2027-01-30", "2027-02-28", "2027-03-30", "2027-04-30"]],
    ["2027-01-31", ["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]],
    ["2026-08-31", ["2026-08-31", "2026-09-30", "2026-10-31", "2026-11-30"]],
    ["2026-12-31", ["2026-12-31", "2027-01-31", "2027-02-28", "2027-03-31"]],
    ["2028-02-29", ["2028-02-29", "2028-03-29", "2028-04-29", "2028-05-29"]],
  ] as const)("keeps the original numeric day for %s without permanent clamp drift", (start, expected) => {
    const result = generateRepeatingStartDates(start, expected[3], { kind: "monthly-date" });
    expect(result.startDates).toEqual(expected);
    expect(result.repeatUntil).toBe(expected[3]);
    expect(result.startDates).toHaveLength(4);
  });

  it("uses Gregorian century leap-year rules", () => {
    expect(generateRepeatingStartDates("2100-01-29", "2100-04-29", { kind: "monthly-date" }).startDates[1]).toBe(
      "2100-02-28",
    );
    expect(generateRepeatingStartDates("2000-01-29", "2000-04-29", { kind: "monthly-date" }).startDates[1]).toBe(
      "2000-02-29",
    );
  });

  it("supports a cutoff near the final ISO date and surfaces domain exhaustion as no repeat", () => {
    expect(generateRepeatingStartDates("9999-09-30", "9999-12-30", { kind: "monthly-date" })).toEqual({
      repeatUntil: "9999-12-30",
      startDates: ["9999-09-30", "9999-10-30", "9999-11-30", "9999-12-30"],
    });
    expect(maximumRepeatUntilDate("9999-10-01")).toBe("9999-12-31");
    expect(generateRepeatingStartDates("9999-10-01", "9999-11-01", { kind: "monthly-date" }).startDates).toEqual([
      "9999-10-01",
      "9999-11-01",
    ]);
    expect(() => generateRepeatingStartDates("9999-12-31", "9999-12-31", { kind: "weeks", interval: 1 })).toThrow(
      /at least one/i,
    );
  });

  it("rejects malformed dates and unsupported runtime intervals", () => {
    expect(() => generateRepeatingStartDates("2026-2-01" as never, "2026-04-01", { kind: "monthly-date" })).toThrow(
      /valid/i,
    );
    expect(() =>
      generateRepeatingStartDates("2026-01-01", "2026-04-01", { kind: "weeks", interval: 5 } as never),
    ).toThrow(/not supported/i);
  });

  it("enforces the start, six-month and at-least-one-repeat cutoff boundaries with stable codes", () => {
    expect(maximumRepeatUntilDate("2026-01-31")).toBe("2026-07-31");
    for (const [cutoff, code] of [
      ["2026-01-30", "cutoff-before-start"],
      ["2026-08-01", "cutoff-after-limit"],
      ["2026-02-06", "no-repeat"],
    ] as const) {
      try {
        generateRepeatingStartDates("2026-01-31", cutoff, { kind: "weeks", interval: 1 });
        throw new Error("Expected repeat generation to reject the cutoff.");
      } catch (error) {
        expect(error).toBeInstanceOf(RepeatingDateError);
        expect((error as RepeatingDateError).code).toBe(code);
      }
    }
  });
});
