import { afterEach, describe, expect, it, vi } from "vitest";
import type { Resource, TimeOff } from "@capacitylens/shared/types/entities";
import { buildTimeOffGroups, currentTimeOffWeekStart } from "./timeOffView";

const timestamp = "2026-05-01T00:00:00.000Z";

function resource(id: string, name: string, kind: Resource["kind"] = "person"): Resource {
  return {
    id,
    accountId: "a-studio",
    createdAt: timestamp,
    updatedAt: timestamp,
    kind,
    name,
    role: "Designer",
    employmentType: "permanent",
    workingHoursPerDay: 8,
    workingDays: [1, 2, 3, 4, 5],
    halfDays: [],
    color: "#2d75da",
  };
}

function entry(id: string, resourceId: string, startDate: string, endDate: string): TimeOff {
  return {
    id,
    accountId: "a-studio",
    createdAt: timestamp,
    updatedAt: timestamp,
    resourceId,
    startDate,
    endDate,
    type: "holiday",
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("currentTimeOffWeekStart", () => {
  it("honours Monday and Sunday company week starts", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-10T12:00:00.000Z"));

    expect(currentTimeOffWeekStart("Etc/GMT", 1)).toBe("2026-06-08");
    expect(currentTimeOffWeekStart("Etc/GMT", 0)).toBe("2026-06-07");
  });

  it("derives today in the company timezone before finding the week boundary", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-08T00:30:00.000Z"));

    expect(currentTimeOffWeekStart("Etc/GMT", 1)).toBe("2026-06-08");
    expect(currentTimeOffWeekStart("Pacific/Honolulu", 1)).toBe("2026-06-01");
  });
});

describe("buildTimeOffGroups", () => {
  it("keeps overlapping entries, drops completed past entries and sorts groups and rows", () => {
    const bruce = resource("r-bruce", "Bruce Wayne");
    const clark = resource("r-clark", "Clark Kent");
    const groups = buildTimeOffGroups(
      [
        entry("later", bruce.id, "2026-06-20", "2026-06-22"),
        entry("clark", clark.id, "2026-06-12", "2026-06-13"),
        entry("tie-b", bruce.id, "2026-06-10", "2026-06-11"),
        entry("past", clark.id, "2026-06-01", "2026-06-07"),
        entry("tie-a", bruce.id, "2026-06-10", "2026-06-11"),
        entry("boundary", bruce.id, "2026-06-06", "2026-06-08"),
      ],
      [clark, bruce],
      "2026-06-08",
      true,
    );

    expect(groups.map((group) => group.name)).toEqual(["Bruce Wayne", "Clark Kent"]);
    expect(groups[0].entries.map(({ id }) => id)).toEqual(["boundary", "tie-a", "tie-b", "later"]);
    expect(groups[1].entries.map(({ id }) => id)).toEqual(["clark"]);
  });

  it("applies placeholder visibility before grouping", () => {
    const placeholder = resource("r-slot", "Unfilled role", "placeholder");
    const timeOff = [entry("slot-leave", placeholder.id, "2026-06-10", "2026-06-11")];

    expect(buildTimeOffGroups(timeOff, [placeholder], "2026-06-08", false)).toEqual([]);
    expect(buildTimeOffGroups(timeOff, [placeholder], "2026-06-08", true)[0].name).toBe("Placeholder");
  });

  it("collects dangling references in one date-sorted final unknown group", () => {
    const clark = resource("r-clark", "Clark Kent");
    const groups = buildTimeOffGroups(
      [
        entry("unknown-later", "missing-2", "2026-07-01", "2026-07-02"),
        entry("known", clark.id, "2026-06-10", "2026-06-11"),
        entry("unknown-earlier", "missing-1", "2026-06-09", "2026-06-10"),
      ],
      [clark],
      "2026-06-08",
      true,
    );

    expect(groups.map((group) => group.name)).toEqual(["Clark Kent", "(unknown)"]);
    expect(groups[1].entries.map(({ id }) => id)).toEqual(["unknown-earlier", "unknown-later"]);
  });
});
