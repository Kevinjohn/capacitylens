import { describe, expect, it } from "vitest";
import { seed, seedForCurrentWeek } from "./seed";
import { dayIndex } from "../lib/dateMath";

describe("fixed demo seed", () => {
  it("returns fresh tables, rows and nested working-day arrays on every call", () => {
    const first = seed();
    const second = seed();
    const expected = structuredClone(second);

    expect(first).toEqual(second);
    for (const account of first.accounts) account.workingDays?.push(0);
    for (const resource of first.resources) {
      resource.workingDays.push(0);
      resource.halfDays.push(1);
    }
    for (const key of Object.keys(first) as (keyof typeof first)[]) {
      expect(first[key]).not.toBe(second[key]);
      for (const row of first[key]) row.updatedAt = "2031-09-17T00:00:00.000Z";
      first[key].length = 0;
    }

    expect(second).toEqual(expected);
    expect(seed()).toEqual(expected);
  });
});

describe("runtime demo seed", () => {
  it("shifts date scenarios onto the reference week while retaining their relative layout", () => {
    const fixed = seed();
    const current = seedForCurrentWeek("2031-09-17"); // Wednesday; week starts Monday 15th

    expect(current.allocations[0]).toMatchObject({
      startDate: "2031-09-15",
      endDate: "2031-09-18",
    });
    expect(current.allocations.map((row) => row.id)).toEqual(fixed.allocations.map((row) => row.id));
    expect(current.allocations.map((row) => dayIndex(row.startDate, current.allocations[0].startDate))).toEqual(
      fixed.allocations.map((row) => dayIndex(row.startDate, fixed.allocations[0].startDate)),
    );
    expect(current.allocations.map((row) => dayIndex(row.endDate, row.startDate))).toEqual(
      fixed.allocations.map((row) => dayIndex(row.endDate, row.startDate)),
    );
    expect(current.timeOff[0]).toMatchObject({
      startDate: "2031-09-24",
      endDate: "2031-09-26",
    });
    expect(current.accounts).toEqual(fixed.accounts);
  });
  it("rejects a reference week whose scenarios exceed the four-digit date domain", () => {
    expect(() => seedForCurrentWeek("9999-12-31")).toThrow(RangeError);
  });
});
