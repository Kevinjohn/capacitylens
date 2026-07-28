import { describe, expect, it } from "vitest";
import { seed, seedForCurrentWeek } from "./seed";
import { dayIndex } from "../lib/dateMath";

describe("runtime demo seed", () => {
  it("shifts date scenarios onto the reference week while retaining their relative layout", () => {
    const fixed = seed();
    const current = seedForCurrentWeek("2031-09-17"); // Wednesday; week starts Monday 15th

    expect(current.allocations[0]).toMatchObject({
      startDate: "2031-09-15",
      endDate: "2031-09-18",
    });
    expect(current.allocations.map((row) => row.id)).toEqual(
      fixed.allocations.map((row) => row.id),
    );
    expect(
      current.allocations.map((row) =>
        dayIndex(row.startDate, current.allocations[0].startDate),
      ),
    ).toEqual(
      fixed.allocations.map((row) =>
        dayIndex(row.startDate, fixed.allocations[0].startDate),
      ),
    );
    expect(
      current.allocations.map((row) => dayIndex(row.endDate, row.startDate)),
    ).toEqual(
      fixed.allocations.map((row) => dayIndex(row.endDate, row.startDate)),
    );
    expect(current.timeOff[0]).toMatchObject({
      startDate: "2031-09-24",
      endDate: "2031-09-26",
    });
    expect(current.accounts).toEqual(fixed.accounts);
  });
});
