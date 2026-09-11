import { describe, expect, it } from "vitest";
import { computeCapacityBarFill } from "./capacityOverviewBar";

describe("computeCapacityBarFill", () => {
  it("fills green proportionally to free hours when available", () => {
    expect(computeCapacityBarFill({ availableHours: 40, freeHours: 20, overHours: 0 })).toEqual({
      kind: "free",
      fraction: 0.5,
    });
  });

  it("renders no fill when fully booked (no free hours, no overbooking)", () => {
    expect(computeCapacityBarFill({ availableHours: 40, freeHours: 0, overHours: 0 })).toEqual({
      kind: "none",
      fraction: 0,
    });
  });

  it("fills red and caps at 100% when overbooked beyond availability", () => {
    expect(computeCapacityBarFill({ availableHours: 40, freeHours: 0, overHours: 48 })).toEqual({
      kind: "over",
      fraction: 1,
    });
  });

  it("renders no fill when unavailable (0 available hours)", () => {
    expect(computeCapacityBarFill({ availableHours: 0, freeHours: 0, overHours: 0 })).toEqual({
      kind: "none",
      fraction: 0,
    });
  });

  it("proportions a partial first week against that week's own availability", () => {
    // A partial week with 16 available hours (2 days) and 8 free hours is 50% green,
    // not measured against a full 40-hour week.
    expect(computeCapacityBarFill({ availableHours: 16, freeHours: 8, overHours: 0 })).toEqual({
      kind: "free",
      fraction: 0.5,
    });
  });
});
