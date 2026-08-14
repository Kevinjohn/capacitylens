import { describe, expect, it } from "vitest";
import { rowScreenReaderSummary } from "./rowSummary";
import type { RowModel } from "./schedulerModel";
import type { Resource } from "@capacitylens/shared/types/entities";

const person: Resource = {
  id: "r1",
  accountId: "a1",
  kind: "person",
  name: "Bruce Wayne",
  role: "Designer",
  employmentType: "permanent",
  engagement: "studio",
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  halfDays: [],
  color: "#2d75da",
  createdAt: "t",
  updatedAt: "t",
};

const row = (over: Partial<RowModel> = {}): RowModel => ({
  resource: person,
  rowHeight: 40,
  bars: [],
  dayStates: [],
  conflictDayCount: 0,
  partialCapacityDayCount: 0,
  timeOff: [],
  utilization: 0,
  overSoon: false,
  dimmed: false,
  ...over,
});

const ctx = { showPersonalUtilization: false, visibleSpanLabel: "4 weeks", drawMode: "work" as const };

describe("rowScreenReaderSummary", () => {
  it("announces only the allocation count for a quiet row", () => {
    expect(rowScreenReaderSummary(row(), ctx)).toBe("0 allocations.");
  });

  it("names every colour-only cue, singular and plural", () => {
    const summary = rowScreenReaderSummary(
      row({
        overSoon: true,
        conflictDayCount: 1,
        partialCapacityDayCount: 3,
        timeOff: [{ id: "t1", x: 0, width: 10, label: "Holiday" }],
        bars: [{} as RowModel["bars"][number]],
      }),
      ctx,
    );
    expect(summary).toBe(
      "Overbooked in the next two weeks. Over capacity on 1 day. 3 half working days. 1 time-off period. 1 allocation.",
    );
  });

  it("folds in the visible-window utilisation only when the pref is on and the row has capacity", () => {
    const busy = row({ utilization: 0.634 });
    expect(rowScreenReaderSummary(busy, { ...ctx, showPersonalUtilization: true })).toBe(
      "63% utilisation over the visible 4 weeks. 0 allocations.",
    );
    // An external / 3rd party carries no capacity, so a 0% would read as a lie.
    const external = row({ resource: { ...person, kind: "external" }, utilization: 0 });
    expect(rowScreenReaderSummary(external, { ...ctx, showPersonalUtilization: true })).toBe("0 allocations.");
  });

  it("drops the allocation count in time-off draw mode", () => {
    expect(rowScreenReaderSummary(row({ conflictDayCount: 2 }), { ...ctx, drawMode: "timeoff" })).toBe(
      "Over capacity on 2 days. ",
    );
  });
});
