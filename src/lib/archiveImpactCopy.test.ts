import { describe, expect, it } from "vitest";
import { buildClientArchiveImpactCopy, buildProjectArchiveImpactCopy, safeArchiveImpact } from "./archiveImpactCopy";
import { makeActivity, makeAppData } from "../test/fixtures";

const impact = (projects: number, phases: number, allocations: number) => ({
  projects,
  phases,
  allocations,
  activities: 0,
  timeOff: 0,
});

describe("archive impact copy", () => {
  it.each([
    [0, "0 projects, 0 phases, and 0 allocations"],
    [1, "1 project, 1 phase, and 1 allocation"],
    [2, "2 projects, 2 phases, and 2 allocations"],
  ] as const)("formats client cascade count %s", (count, expected) => {
    const copy = buildClientArchiveImpactCopy(impact(count, count, count));
    expect(copy).toContain(expected);
    expect(copy).not.toContain("(s)");
  });

  it.each([
    [0, "0 phases and 0 allocations"],
    [1, "1 phase and 1 allocation"],
    [2, "2 phases and 2 allocations"],
  ] as const)("formats project cascade count %s", (count, expected) => {
    const copy = buildProjectArchiveImpactCopy(impact(0, count, count));
    expect(copy).toContain(expected);
    expect(copy).not.toContain("(s)");
  });
});

describe("safeArchiveImpact", () => {
  it("returns the impact for a row that is present and active", () => {
    const activity = makeActivity({ id: "act-1", kind: "internal" });
    const data = makeAppData({ activities: [activity] });

    expect(safeArchiveImpact(data, "activities", activity.id)).toEqual({
      projects: 0,
      phases: 0,
      activities: 0,
      allocations: 0,
      timeOff: 0,
    });
  });

  it("returns undefined instead of throwing when the row is missing", () => {
    const data = makeAppData({ activities: [] });

    expect(safeArchiveImpact(data, "activities", "missing")).toBeUndefined();
  });

  it("returns undefined instead of throwing when the row is already archived", () => {
    const activity = makeActivity({
      id: "act-1",
      kind: "internal",
      archivedAt: "2020-01-01T00:00:00.000Z",
    });
    const data = makeAppData({ activities: [activity] });

    expect(safeArchiveImpact(data, "activities", activity.id)).toBeUndefined();
  });
});
