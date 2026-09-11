/* eslint-disable max-params */
import { describe, expect, it } from "vitest";
import type { Allocation, AppData, Resource, Weekday } from "@capacitylens/shared/types/entities";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import { buildCapacityOverviewWeeks } from "./capacityOverviewDates";
import { buildCapacityOverviewModel, type CapacityOverviewModel } from "./capacityOverviewModel";

const ACCOUNT_ID = "account-1";
const BASE = { accountId: ACCOUNT_ID, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5];

function person(id: string, overrides: Partial<Resource> = {}): Resource {
  return {
    ...BASE,
    id,
    kind: "person",
    name: id,
    role: "Designer",
    employmentType: "permanent",
    engagement: "studio",
    workingHoursPerDay: 8,
    workingDays: WEEKDAYS,
    halfDays: [],
    color: "#111111",
    ...overrides,
  };
}

function placeholder(id: string, overrides: Partial<Resource> = {}): Resource {
  return person(id, { kind: "placeholder", role: "Designer", ...overrides });
}

function allocation(
  id: string,
  resourceId: string,
  startDate: string,
  endDate: string,
  hoursPerDay: number,
  overrides: Partial<Allocation> = {},
): Allocation {
  return {
    ...BASE,
    id,
    resourceId,
    activityId: `activity-${id}`,
    startDate,
    endDate,
    hoursPerDay,
    status: "confirmed",
    ...overrides,
  };
}

function data(resources: Resource[], allocations: Allocation[] = []): AppData {
  return { ...emptyAppData(), resources, allocations };
}

function week(model: CapacityOverviewModel, rowId: string, index: number) {
  const row = model.groups.flatMap((group) => group.rows).find((candidate) => candidate.resource.id === rowId);
  if (!row) throw new Error(`Missing overview row ${rowId}`);
  const result = row.weeks[index];
  if (!result) throw new Error(`Missing overview week ${index}`);
  return result;
}

describe("buildCapacityOverviewWeeks", () => {
  it("builds the remaining current week followed by three full workspace weeks", () => {
    expect(buildCapacityOverviewWeeks({ today: "2026-06-03", weekStartsOn: 1 })).toEqual([
      { index: 0, key: "this-week", start: "2026-06-03", end: "2026-06-07", partial: true },
      { index: 1, key: "next-week", start: "2026-06-08", end: "2026-06-14", partial: false },
      { index: 2, key: "week-3", start: "2026-06-15", end: "2026-06-21", partial: false },
      { index: 3, key: "week-4", start: "2026-06-22", end: "2026-06-28", partial: false },
    ]);
  });

  it("respects a Sunday workspace week start", () => {
    expect(buildCapacityOverviewWeeks({ today: "2026-06-06", weekStartsOn: 0 })[0]).toEqual({
      index: 0,
      key: "this-week",
      start: "2026-06-06",
      end: "2026-06-06",
      partial: true,
    });
    expect(buildCapacityOverviewWeeks({ today: "2026-06-06", weekStartsOn: 0 })[1]).toMatchObject({
      start: "2026-06-07",
      end: "2026-06-13",
    });
  });
});

describe("buildCapacityOverviewModel", () => {
  it("keeps daily spare and overload separate before quarter-day rounding", () => {
    const resource = person("person-1");
    const result = buildCapacityOverviewModel({
      data: data(
        [resource],
        [
          allocation("over", resource.id, "2026-06-03", "2026-06-03", 10),
          allocation("spare", resource.id, "2026-06-04", "2026-06-04", 1),
        ],
      ),
      today: "2026-06-01",
      accountWorkingDays: WEEKDAYS,
      weekStartsOn: 1,
      disciplinesEnabled: false,
    });

    expect(week(result, resource.id, 0)).toMatchObject({
      availableHours: 40,
      freeHours: 31,
      overHours: 2,
      freeDays: 3.75,
      overDays: 0.25,
      state: "available",
    });
  });

  it("floors free capacity and ceils overload after precise weekly aggregation", () => {
    const resource = person("person-1");
    const result = buildCapacityOverviewModel({
      data: data([resource], [allocation("fractional", resource.id, "2026-06-01", "2026-06-02", 7)]),
      today: "2026-06-01",
      accountWorkingDays: WEEKDAYS,
      disciplinesEnabled: false,
    });

    expect(week(result, resource.id, 0)).toMatchObject({
      freeHours: 26,
      overHours: 0,
      freeDays: 3.25,
    });
  });

  it("marks a working week fully booked and a zero-capacity week unavailable", () => {
    const working = person("working");
    const away = person("away");
    const result = buildCapacityOverviewModel({
      data: data([working, away], [allocation("full", working.id, "2026-06-01", "2026-06-05", 8)]),
      today: "2026-06-01",
      accountWorkingDays: WEEKDAYS,
      timeOff: [
        {
          ...BASE,
          id: "leave",
          resourceId: away.id,
          startDate: "2026-06-01",
          endDate: "2026-06-05",
          type: "holiday",
        },
      ],
      disciplinesEnabled: false,
    });

    expect(week(result, working.id, 0).state).toBe("fully-booked");
    expect(week(result, away.id, 0).state).toBe("unavailable");
  });

  it("treats less than a quarter-day of precise spare time as fully booked", () => {
    const resource = person("almost-full");
    const result = buildCapacityOverviewModel({
      data: data([resource], [allocation("load", resource.id, "2026-06-01", "2026-06-05", 7.8)]),
      today: "2026-06-01",
      accountWorkingDays: WEEKDAYS,
      disciplinesEnabled: false,
    });

    const resultWeek = week(result, resource.id, 0);
    expect(resultWeek.availableHours).toBe(40);
    expect(resultWeek.freeHours).toBeCloseTo(1);
    expect(resultWeek.freeDays).toBe(0);
    expect(resultWeek.state).toBe("fully-booked");
  });

  it("removes company closures from working capacity", () => {
    const resource = person("person-1");
    const result = buildCapacityOverviewModel({
      data: data([resource]),
      today: "2026-06-01",
      accountWorkingDays: WEEKDAYS,
      closures: [
        {
          ...BASE,
          id: "closure",
          name: "Founders Day",
          startDate: "2026-06-01",
          endDate: "2026-06-01",
        },
      ],
      disciplinesEnabled: false,
    });

    expect(week(result, resource.id, 0)).toMatchObject({ availableHours: 32, freeDays: 4 });
  });

  it("excludes tentative load when requested and recalculates capacity", () => {
    const resource = person("person-1");
    const allocations = [allocation("tentative", resource.id, "2026-06-01", "2026-06-05", 8, { status: "tentative" })];
    const included = buildCapacityOverviewModel({
      data: data([resource], allocations),
      today: "2026-06-01",
      accountWorkingDays: WEEKDAYS,
      disciplinesEnabled: false,
    });
    const excluded = buildCapacityOverviewModel({
      data: data([resource], allocations),
      today: "2026-06-01",
      accountWorkingDays: WEEKDAYS,
      includeTentative: false,
      disciplinesEnabled: false,
    });

    expect(week(included, resource.id, 0).freeDays).toBe(0);
    expect(week(excluded, resource.id, 0).freeDays).toBe(5);
  });

  it("excludes tentative placeholder demand when requested", () => {
    const slot = placeholder("slot");
    const allocations = [
      allocation("tentative-demand", slot.id, "2026-06-01", "2026-06-01", 8, { status: "tentative" }),
    ];
    const included = buildCapacityOverviewModel({
      data: data([slot], allocations),
      today: "2026-06-01",
      placeholdersEnabled: true,
      disciplinesEnabled: false,
    });
    const excluded = buildCapacityOverviewModel({
      data: data([slot], allocations),
      today: "2026-06-01",
      includeTentative: false,
      placeholdersEnabled: true,
      disciplinesEnabled: false,
    });

    expect(week(included, slot.id, 0).unassignedDemandDays).toBe(1);
    expect(week(excluded, slot.id, 0).unassignedDemandDays).toBe(0);
  });

  it("shows placeholder demand separately, without free capacity or people totals", () => {
    const real = person("real");
    const slot = placeholder("slot");
    const result = buildCapacityOverviewModel({
      data: data([real, slot], [allocation("demand", slot.id, "2026-06-01", "2026-06-02", 8)]),
      today: "2026-06-01",
      accountWorkingDays: WEEKDAYS,
      placeholdersEnabled: true,
      disciplinesEnabled: false,
    });
    const slotWeek = week(result, slot.id, 0);
    const summary = result.summary;

    expect(slotWeek).toMatchObject({ freeDays: 0, overDays: 0, unassignedDemandHours: 16, unassignedDemandDays: 2 });
    expect(summary).toMatchObject({ peopleCount: 1 });
    expect(summary.weeks[0]).toMatchObject({ freeDays: 5, unassignedDemandDays: 2 });
  });

  it("keeps disabled-discipline fallback groups and placeholder demand visibly separate", () => {
    const studio = person("studio", { engagement: "studio" });
    const supplementary = person("supplementary", { engagement: "supplementary" });
    const slot = placeholder("slot", { engagement: "studio" });
    const grouped = buildCapacityOverviewModel({
      data: data([studio, supplementary, slot], [allocation("demand", slot.id, "2026-06-01", "2026-06-01", 8)]),
      today: "2026-06-01",
      accountWorkingDays: WEEKDAYS,
      placeholdersEnabled: true,
      disciplinesEnabled: false,
      groupResourcesByEngagement: true,
    });
    const ungrouped = buildCapacityOverviewModel({
      data: data([studio, supplementary, slot], [allocation("demand", slot.id, "2026-06-01", "2026-06-01", 8)]),
      today: "2026-06-01",
      accountWorkingDays: WEEKDAYS,
      placeholdersEnabled: true,
      disciplinesEnabled: false,
      groupResourcesByEngagement: false,
    });

    expect(grouped.groups.map((group) => group.key)).toEqual([
      "engagement-studio",
      "engagement-supplementary",
      "placeholders",
    ]);
    expect(ungrouped.groups.map((group) => group.key)).toEqual(["overall", "placeholders"]);
    expect(grouped.summary.peopleCount).toBe(2);
    expect(grouped.summary.placeholderCount).toBe(1);
  });

  it("keeps placeholder demand separate from discipline groups", () => {
    const designer = person("designer", { disciplineId: "design" });
    const slot = placeholder("slot", { disciplineId: "design" });
    const result = buildCapacityOverviewModel({
      data: {
        ...data([designer, slot], [allocation("demand", slot.id, "2026-06-01", "2026-06-01", 8)]),
        disciplines: [{ ...BASE, id: "design", name: "Design", sortOrder: 0 }],
      },
      today: "2026-06-01",
      accountWorkingDays: WEEKDAYS,
      placeholdersEnabled: true,
      disciplinesEnabled: true,
    });

    expect(result.groups.map((group) => group.key)).toEqual(["design", "placeholders"]);
    expect(result.groups[0]?.rows.map((row) => row.resource.id)).toEqual([designer.id]);
    expect(result.groups[1]?.rows.map((row) => row.resource.id)).toEqual([slot.id]);
  });

  it("keeps placeholders under Has availability when they have demand and filters people by any quarter day", () => {
    const available = person("available");
    const full = person("full");
    const slot = placeholder("slot");
    const result = buildCapacityOverviewModel({
      data: data(
        [available, full, slot],
        [
          allocation("full-load-1", full.id, "2026-06-01", "2026-06-05", 8),
          allocation("full-load-2", full.id, "2026-06-08", "2026-06-12", 8),
          allocation("full-load-3", full.id, "2026-06-15", "2026-06-19", 8),
          allocation("full-load-4", full.id, "2026-06-22", "2026-06-26", 8),
          allocation("demand", slot.id, "2026-06-08", "2026-06-08", 1),
        ],
      ),
      today: "2026-06-01",
      accountWorkingDays: WEEKDAYS,
      placeholdersEnabled: true,
      hasAvailability: true,
      disciplinesEnabled: false,
    });
    const visible = result.groups.flatMap((group) => group.rows).map((row) => row.resource.id);

    expect(visible).toEqual([available.id, slot.id]);
    expect(result.groups[0]?.summary.peopleCount).toBe(2);
  });

  it("follows discipline and engagement ordering while excluding external and archived resources", () => {
    const first = person("z-person", { engagement: "supplementary", disciplineId: "design" });
    const second = person("a-person", { disciplineId: "design" });
    const archived = person("archived", { disciplineId: "design", archivedAt: "2026-01-02T00:00:00.000Z" });
    const external = person("external", { kind: "external", disciplineId: "design" });
    const result = buildCapacityOverviewModel({
      data: {
        ...data([first, second, archived, external]),
        disciplines: [
          { ...BASE, id: "design", name: "Design", sortOrder: 0 },
          { ...BASE, id: "development", name: "Development", sortOrder: 1 },
        ],
      },
      today: "2026-06-01",
      accountWorkingDays: WEEKDAYS,
      disciplinesEnabled: true,
    });

    expect(result.groups.map((group) => group.key)).toEqual(["design"]);
    expect(result.groups[0]?.rows.map((row) => row.resource.id)).toEqual([second.id, first.id]);
  });

  it("retains exact summary totals when row display values are rounded", () => {
    const first = person("first");
    const second = person("second");
    const result = buildCapacityOverviewModel({
      data: data(
        [first, second],
        [
          allocation("first-load", first.id, "2026-06-01", "2026-06-01", 7),
          allocation("second-load", second.id, "2026-06-01", "2026-06-01", 7),
        ],
      ),
      today: "2026-06-01",
      accountWorkingDays: WEEKDAYS,
      disciplinesEnabled: false,
    });

    const summary = result.summary;
    expect(week(result, first.id, 0).freeDays).toBe(4);
    expect(week(result, second.id, 0).freeDays).toBe(4);
    expect(summary).toMatchObject({ peopleCount: 2 });
    expect(summary.weeks[0]).toMatchObject({ freeHours: 66, freeDays: 8.25 });
  });

  it("returns a measured-capacity explanation in Blocks mode", () => {
    const result = buildCapacityOverviewModel({
      data: data([person("person-1")]),
      today: "2026-06-01",
      blocksMode: true,
    });

    expect(result).toMatchObject({ measured: false, reason: "blocks-mode", groups: [] });
  });

  it("keeps four summary week slots when no eligible rows remain", () => {
    const result = buildCapacityOverviewModel({ data: data([]), today: "2026-06-01" });

    expect(result.summary.weeks).toHaveLength(4);
  });
});
