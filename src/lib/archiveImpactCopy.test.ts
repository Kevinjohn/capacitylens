import { describe, expect, it } from "vitest";
import { clientArchiveImpactCopy, projectArchiveImpactCopy } from "./archiveImpactCopy";

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
    const copy = clientArchiveImpactCopy(impact(count, count, count));
    expect(copy).toContain(expected);
    expect(copy).not.toContain("(s)");
  });

  it.each([
    [0, "0 phases and 0 allocations"],
    [1, "1 phase and 1 allocation"],
    [2, "2 phases and 2 allocations"],
  ] as const)("formats project cascade count %s", (count, expected) => {
    const copy = projectArchiveImpactCopy(impact(0, count, count));
    expect(copy).toContain(expected);
    expect(copy).not.toContain("(s)");
  });
});
