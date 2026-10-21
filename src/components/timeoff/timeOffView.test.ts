import { describe, expect, it } from "vitest";
import type { Closure, Resource, TimeOff } from "@capacitylens/shared/types/entities";
import { buildClosureList, buildTimeOffGroups } from "./timeOffView";

interface EntryInput {
  id: string;
  resourceId: string;
  startDate: string;
  endDate: string;
}

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
    engagement: "studio" as const,
    workingHoursPerDay: 8,
    workingDays: [1, 2, 3, 4, 5],
    halfDays: [],
    color: "#2d75da",
  };
}

function entry({ id, resourceId, startDate, endDate }: EntryInput): TimeOff {
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

describe("buildTimeOffGroups", () => {
  it("keeps overlapping entries, drops completed past entries and sorts groups and rows", () => {
    const bruce = resource("r-bruce", "Bruce Wayne");
    const clark = resource("r-clark", "Clark Kent");
    const groups = buildTimeOffGroups({
      timeOff: [
        entry({ id: "later", resourceId: bruce.id, startDate: "2026-06-20", endDate: "2026-06-22" }),
        entry({ id: "clark", resourceId: clark.id, startDate: "2026-06-12", endDate: "2026-06-13" }),
        entry({ id: "tie-b", resourceId: bruce.id, startDate: "2026-06-10", endDate: "2026-06-11" }),
        entry({ id: "past", resourceId: clark.id, startDate: "2026-06-01", endDate: "2026-06-07" }),
        entry({ id: "tie-a", resourceId: bruce.id, startDate: "2026-06-10", endDate: "2026-06-11" }),
        entry({ id: "boundary", resourceId: bruce.id, startDate: "2026-06-06", endDate: "2026-06-08" }),
      ],
      resources: [clark, bruce],
      weekStart: "2026-06-08",
      placeholdersEnabled: true,
    });

    expect(groups.map((group) => group.name)).toEqual(["Bruce Wayne", "Clark Kent"]);
    expect(groups[0]?.entries.map(({ id }) => id)).toEqual(["boundary", "tie-a", "tie-b", "later"]);
    expect(groups[1]?.entries.map(({ id }) => id)).toEqual(["clark"]);
  });

  it("applies placeholder visibility before grouping", () => {
    const placeholder = resource("r-slot", "Unfilled role", "placeholder");
    const timeOff = [
      entry({ id: "slot-leave", resourceId: placeholder.id, startDate: "2026-06-10", endDate: "2026-06-11" }),
    ];

    expect(
      buildTimeOffGroups({
        timeOff: timeOff,
        resources: [placeholder],
        weekStart: "2026-06-08",
        placeholdersEnabled: false,
      }),
    ).toEqual([]);
    expect(
      buildTimeOffGroups({
        timeOff: timeOff,
        resources: [placeholder],
        weekStart: "2026-06-08",
        placeholdersEnabled: true,
      })[0]?.name,
    ).toBe("Placeholder");
  });

  it("collects dangling references in one date-sorted final unknown group", () => {
    const clark = resource("r-clark", "Clark Kent");
    const groups = buildTimeOffGroups({
      timeOff: [
        entry({ id: "unknown-later", resourceId: "missing-2", startDate: "2026-07-01", endDate: "2026-07-02" }),
        entry({ id: "known", resourceId: clark.id, startDate: "2026-06-10", endDate: "2026-06-11" }),
        entry({ id: "unknown-earlier", resourceId: "missing-1", startDate: "2026-06-09", endDate: "2026-06-10" }),
      ],
      resources: [clark],
      weekStart: "2026-06-08",
      placeholdersEnabled: true,
    });

    expect(groups.map((group) => group.name)).toEqual(["Clark Kent", "(unknown)"]);
    expect(groups[1]?.entries.map(({ id }) => id)).toEqual(["unknown-earlier", "unknown-later"]);
  });
});

describe("buildClosureList", () => {
  const closure = (id: string, startDate: string, endDate: string): Closure => ({
    id,
    accountId: "a-studio",
    createdAt: timestamp,
    updatedAt: timestamp,
    name: id,
    startDate,
    endDate,
  });

  it("keeps overlapping and future closures while sorting their literal spans", () => {
    expect(
      buildClosureList(
        [
          closure("later", "2026-07-01", "2026-07-04"),
          closure("past", "2026-06-01", "2026-06-07"),
          closure("boundary", "2026-06-06", "2026-06-08"),
        ],
        "2026-06-08",
      ).map(({ id }) => id),
    ).toEqual(["boundary", "later"]);
  });
});
