import { describe, expect, it } from "vitest";
import type { AppData } from "@capacitylens/shared/types/entities";
import { buildEmptyFilters } from "../../store/useStore";
import { makeResource, requireValue } from "../../test/fixtures";
import { buildSchedulerModel, type GroupModel } from "./schedulerModel";
import { allBars, dataset, days, end, geom, start, withExternal } from "./schedulerModel.testSupport";

function registerMovedSchedulerTests23811(
  companyData: () => AppData,
  buildCompany: (blocksMode?: boolean) => GroupModel[],
) {
  it("applies closure capacity and conflict cells to every tracked row", () => {
    const rows = buildCompany().flatMap((group) => group.rows);
    const r1 = requireValue(
      rows.find((row) => row.resource.id === "r1"),
      "r1 scheduler row",
    );
    const r2 = requireValue(
      rows.find((row) => row.resource.id === "r2"),
      "r2 scheduler row",
    );
    const placeholder = requireValue(
      rows.find((row) => row.resource.id === "placeholder-1"),
      "placeholder scheduler row",
    );

    // Wednesday: r1 has work (red), while r2 and the placeholder have only the grey closure.
    expect(r1.dayStates[2]).toMatchObject({
      unavailable: true,
      hasTimeOff: true,
      over: true,
      timeOffConflict: true,
    });
    expect(r2.dayStates[2]).toMatchObject({
      unavailable: true,
      hasTimeOff: true,
      over: false,
      timeOffConflict: false,
    });
    expect(placeholder.dayStates[2]).toMatchObject({
      unavailable: true,
      hasTimeOff: true,
      over: false,
      timeOffConflict: false,
    });

    // Saturday is already recurring-off: the marker/hatch remains without red unless work opts in.
    expect(r1.dayStates[5]).toMatchObject({ hasTimeOff: true, over: false, timeOffConflict: false });
    expect(r2.dayStates[5]).toMatchObject({ hasTimeOff: true, over: true, timeOffConflict: true });
    expect(r1.overSoon).toBe(true);
    expect(placeholder.overSoon).toBe(false);

    // Personal time off remains a separate rendered fact while the closure independently removes capacity.
    expect(r1.timeOff.map((entry) => entry.id)).toContain("personal-r1-wednesday");
    expect(r2.timeOff).toEqual([]);
    expect(companyData().closures.map((entry) => entry.id)).toContain("company-wednesday");
    expect(r1.conflictDayCount).toBe(1);
  });
}

function registerMovedSchedulerTests23812(buildCompany: (blocksMode?: boolean) => GroupModel[]) {
  it("flags a zero-load Block overlapping a closure", () => {
    const r1 = requireValue(
      buildCompany(true)
        .flatMap((group) => group.rows)
        .find((row) => row.resource.id === "r1"),
      "r1 scheduler row",
    );

    expect(r1.dayStates[2]).toMatchObject({ over: false, hasTimeOff: true, timeOffConflict: true });
    expect(r1.conflictDayCount).toBe(1);
  });
}

function registerMovedSchedulerTests23813(buildCompany: (blocksMode?: boolean) => GroupModel[]) {
  it("keeps external capacity starved and exempt from company closures", () => {
    const external = requireValue(
      requireValue(
        buildCompany().find((group) => group.external),
        "external group",
      ).rows[0],
      "external scheduler row",
    );

    expect(external.timeOff).toEqual([]);
    expect(external.conflictDayCount).toBe(0);
    expect(external.utilization).toBe(0);
    expect(external.overSoon).toBe(false);
    expect(external.dayStates[2]).toMatchObject({
      creationBlocked: false,
      unavailable: false,
      hasTimeOff: false,
      over: false,
      timeOffConflict: false,
    });
  });
}

function registerMovedSchedulerTests201011() {
  it("external rows use literal {over:false, unavailable:false} day-states (real booleans, not an empty object)", () => {
    const model = buildSchedulerModel({
      data: withExternal(),
      geom: geom,
      days: days,
      visibleWindow: { start: start, end: end },
      overSoonWindow: { start: start, end: end },
      filters: buildEmptyFilters(),
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    });
    const ext = model.at(-1)?.rows[0];
    expect(ext).toBeDefined();
    if (!ext) throw new Error("Expected the external resource row.");
    expect(ext.dayStates[0]).toEqual({
      over: false,
      timeOffConflict: false,
      unavailable: false,
      partialCapacity: false,
      creationBlocked: false,
      // Starved of capacity, so a stray time-off record cannot mark an external's day either.
      hasTimeOff: false,
    });
  });
}

function registerMovedSchedulerTests201012() {
  it("a dangling activityId (missing from `activities`) degrades to safe fallbacks, never throws", () => {
    const d = dataset();
    d.allocations.push({
      id: "a-ghost",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      resourceId: "r1",
      activityId: "ghost-activity",
      startDate: "2026-06-05",
      endDate: "2026-06-05",
      hoursPerDay: 8,
      status: "confirmed",
    });
    let model: GroupModel[] = [];
    expect(() => {
      model = buildSchedulerModel({
        data: d,
        geom: geom,
        days: days,
        visibleWindow: { start: start, end: end },
        overSoonWindow: { start: start, end: end },
        filters: buildEmptyFilters(),
        preferences: {
          disciplinesEnabled: true,
          placeholdersEnabled: true,
          externalEnabled: true,
        },
      });
    }).not.toThrow();
    const bar = requireValue(
      allBars(model).find((b) => b.allocation.id === "a-ghost"),
      "ghost allocation bar",
    );
    expect(bar.label).toBe("Activity"); // fallback label, not a crash on the missing activity lookup
    expect(bar.project).toBeUndefined();
    expect(bar.client).toBeUndefined();
  });
}

function registerMovedSchedulerTests201013(
  buildDanglingActivityData: () => AppData,
  assertDanglingActivityFiltersDoNotThrow: (data: AppData) => void,
  buildDanglingActivityModel: (data: AppData) => GroupModel[],
) {
  it("a dangling activityId does not throw when project/client/activity-kind filters are active, and is filtered out", () => {
    const d = buildDanglingActivityData();
    assertDanglingActivityFiltersDoNotThrow(d);
    const model = buildDanglingActivityModel(d);
    expect(allBars(model).map((b) => b.allocation.id)).not.toContain("a-ghost2");
  });
}

function registerMovedSchedulerTests201014() {
  it("keeps assigned discipline bands before unassigned Studio, Supplementary and External bands", () => {
    const d = withExternal();
    const template = requireValue(d.resources[0], "resource template");
    const unassignedTemplate = { ...template };
    delete unassignedTemplate.disciplineId;
    d.resources.push(
      { ...unassignedTemplate, id: "unassigned-studio", name: "Studio Floater" },
      {
        ...unassignedTemplate,
        id: "unassigned-supplementary",
        name: "Supplementary Floater",
        engagement: "supplementary",
      },
      { ...template, id: "dangling-studio", name: "Deleted Discipline", disciplineId: "deleted-discipline" },
    );

    const model = buildSchedulerModel({
      data: d,
      geom,
      days,
      visibleWindow: { start, end },
      overSoonWindow: { start, end },
      filters: buildEmptyFilters(),
      preferences: { disciplinesEnabled: true, placeholdersEnabled: true, externalEnabled: true },
    });

    expect(model.map((group) => group.title)).toEqual([
      "Design",
      "Development",
      "Studio",
      "Supplementary",
      "External / 3rd party",
    ]);
    expect(model.map((group) => group.key)).toEqual([
      "d-design",
      "d-dev",
      "engagement-studio",
      "engagement-supplementary",
      "external",
    ]);
    expect(
      requireValue(
        model.find((group) => group.title === "Studio"),
        "Studio group",
      )
        .rows.map((row) => row.resource.id)
        .sort(),
    ).toEqual(["dangling-studio", "unassigned-studio"]);
  });
}

function registerMovedSchedulerTests201015() {
  it("uses engagement bands when no disciplines exist and ignores a stale discipline filter", () => {
    const d = withExternal();
    d.disciplines = [];
    d.resources[1] = { ...requireValue(d.resources[1], "second resource"), engagement: "supplementary" };

    const model = buildSchedulerModel({
      data: d,
      geom,
      days,
      visibleWindow: { start, end },
      overSoonWindow: { start, end },
      filters: { ...buildEmptyFilters(), disciplineId: "deleted-discipline" },
      preferences: { disciplinesEnabled: true, placeholdersEnabled: true, externalEnabled: true },
    });

    expect(model.map((group) => group.title)).toEqual(["Studio", "Supplementary", "External / 3rd party"]);
    expect(
      model
        .flatMap((group) => group.rows)
        .map((row) => row.resource.id)
        .sort(),
    ).toEqual(["ext1", "r1", "r2"]);
  });
}

function registerMovedSchedulerTests201016() {
  it("uses engagement fallback bands when disciplines exist but nobody is assigned", () => {
    const d = dataset();
    d.resources = d.resources.map((resource, index) => {
      const unassignedResource = { ...resource };
      delete unassignedResource.disciplineId;
      return {
        ...unassignedResource,
        engagement: index === 0 ? "studio" : "supplementary",
      };
    });

    const model = buildSchedulerModel({
      data: d,
      geom,
      days,
      visibleWindow: { start, end },
      overSoonWindow: { start, end },
      filters: buildEmptyFilters(),
      preferences: { disciplinesEnabled: true, placeholdersEnabled: true, externalEnabled: true },
    });

    expect(model.map((group) => group.title)).toEqual(["Studio", "Supplementary"]);
    expect(
      model
        .flatMap((group) => group.rows)
        .map((row) => row.resource.id)
        .sort(),
    ).toEqual(["r1", "r2"]);
  });
}

function registerMovedSchedulerTests201017() {
  it("does not render empty fallback bands, including an external-only schedule", () => {
    const studioOnly = dataset();
    studioOnly.disciplines = [];
    expect(
      buildSchedulerModel({
        data: studioOnly,
        geom,
        days,
        visibleWindow: { start, end },
        overSoonWindow: { start, end },
        filters: buildEmptyFilters(),
        preferences: { disciplinesEnabled: true, placeholdersEnabled: true, externalEnabled: true },
      }).map((group) => group.title),
    ).toEqual(["Studio"]);

    const externalOnly = withExternal();
    externalOnly.disciplines = [];
    externalOnly.resources = externalOnly.resources.filter((resource) => resource.id === "ext1");
    expect(
      buildSchedulerModel({
        data: externalOnly,
        geom,
        days,
        visibleWindow: { start, end },
        overSoonWindow: { start, end },
        filters: buildEmptyFilters(),
        preferences: { disciplinesEnabled: true, placeholdersEnabled: true, externalEnabled: true },
      }).map((group) => group.title),
    ).toEqual(["External / 3rd party"]);
  });
}

function registerMovedSchedulerTests201018() {
  it("uses one Unassigned fallback when engagement grouping is disabled", () => {
    const d = withExternal();
    const firstResource = d.resources[0];
    expect(firstResource).toBeDefined();
    if (!firstResource) throw new Error("Expected the base scheduler resource.");
    const unassignedResource = { ...firstResource };
    delete unassignedResource.disciplineId;
    d.resources[0] = unassignedResource;
    const withDisciplines = buildSchedulerModel({
      data: d,
      geom,
      days,
      visibleWindow: { start, end },
      overSoonWindow: { start, end },
      filters: buildEmptyFilters(),
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
        groupResourcesByEngagement: false,
      },
    });
    expect(withDisciplines.map((group) => group.title)).toEqual(["Development", "Unassigned", "External / 3rd party"]);

    const withoutDisciplines = buildSchedulerModel({
      data: d,
      geom,
      days,
      visibleWindow: { start, end },
      overSoonWindow: { start, end },
      filters: { ...buildEmptyFilters(), disciplineId: "d-dev" },
      preferences: {
        disciplinesEnabled: false,
        placeholdersEnabled: true,
        externalEnabled: true,
        groupResourcesByEngagement: false,
      },
    });
    expect(withoutDisciplines.map((group) => group.title)).toEqual(["Unassigned", "External / 3rd party"]);
    expect(requireValue(withoutDisciplines[0], "unassigned group").rows).toHaveLength(2);
  });
}

function registerMovedSchedulerTests201019() {
  it("group.external is a real boolean: true for the external band, false (not undefined) for a discipline group", () => {
    const model = buildSchedulerModel({
      data: withExternal(),
      geom: geom,
      days: days,
      visibleWindow: { start: start, end: end },
      overSoonWindow: { start: start, end: end },
      filters: buildEmptyFilters(),
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    });
    const design = requireValue(
      model.find((g) => g.title === "Design"),
      "Design group",
    );
    const externalGroup = requireValue(model.at(-1), "external group");
    expect(design.external).toBe(false);
    expect(externalGroup.external).toBe(true);
  });
}

function registerMovedSchedulerTests201020() {
  it("placeholder ordering is stable WITHIN each kind: multiple persons keep their relative order, multiple placeholders too", () => {
    const d = dataset();
    d.resources = [
      makeResource({
        id: "ph1",
        accountId: "acct-test",
        kind: "placeholder",
        role: "Designer",
        disciplineId: "d-design",
        color: "#9",
      }),
      makeResource({
        id: "r1",
        accountId: "acct-test",
        name: "Dana",
        role: "Designer",
        disciplineId: "d-design",
        color: "#4",
      }),
      makeResource({
        id: "ph2",
        accountId: "acct-test",
        kind: "placeholder",
        role: "Designer",
        disciplineId: "d-design",
        color: "#8",
      }),
      makeResource({
        id: "r2",
        accountId: "acct-test",
        name: "Sam",
        role: "Designer",
        disciplineId: "d-design",
        color: "#5",
      }),
    ];
    const model = buildSchedulerModel({
      data: d,
      geom: geom,
      days: days,
      visibleWindow: { start: start, end: end },
      overSoonWindow: { start: start, end: end },
      filters: buildEmptyFilters(),
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    });
    const design = requireValue(
      model.find((g) => g.title === "Design"),
      "Design group",
    );
    expect(design.rows.map((r) => r.resource.id)).toEqual(["r1", "r2", "ph1", "ph2"]);
  });
}

function buildDanglingActivityData() {
  const d = dataset();
  d.allocations.push({
    id: "a-ghost2",
    accountId: "acct-test",
    createdAt: "t",
    updatedAt: "t",
    resourceId: "r1",
    activityId: "ghost-activity-2",
    startDate: "2026-06-05",
    endDate: "2026-06-05",
    hoursPerDay: 8,
    status: "confirmed",
  });
  return d;
}

function assertDanglingActivityFiltersDoNotThrow(d: AppData) {
  expect(() =>
    buildSchedulerModel({
      data: d,
      geom: geom,
      days: days,
      visibleWindow: { start: start, end: end },
      overSoonWindow: { start: start, end: end },
      filters: { ...buildEmptyFilters(), projectId: "p1" },
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    }),
  ).not.toThrow();
  expect(() =>
    buildSchedulerModel({
      data: d,
      geom: geom,
      days: days,
      visibleWindow: { start: start, end: end },
      overSoonWindow: { start: start, end: end },
      filters: { ...buildEmptyFilters(), clientId: "c1" },
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    }),
  ).not.toThrow();
  expect(() =>
    buildSchedulerModel({
      data: d,
      geom: geom,
      days: days,
      visibleWindow: { start: start, end: end },
      overSoonWindow: { start: start, end: end },
      filters: { ...buildEmptyFilters(), activityKind: "internal" },
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    }),
  ).not.toThrow();
}

function buildDanglingActivityModel(d: AppData) {
  const model = buildSchedulerModel({
    data: d,
    geom: geom,
    days: days,
    visibleWindow: { start: start, end: end },
    overSoonWindow: { start: start, end: end },
    filters: { ...buildEmptyFilters(), projectId: "p1" },
    preferences: {
      disciplinesEnabled: true,
      placeholdersEnabled: true,
      externalEnabled: true,
    },
  });
  return model;
}

function buildCompanyClosureData(): AppData {
  const d = withExternal();
  d.resources.push(
    makeResource({
      id: "placeholder-1",
      accountId: "acct-test",
      kind: "placeholder",
      name: "Design placeholder",
      role: "Designer",
      disciplineId: "d-design",
    }),
  );
  d.allocations.push({
    id: "ignored-r2-saturday",
    accountId: "acct-test",
    createdAt: "t",
    updatedAt: "t",
    resourceId: "r2",
    activityId: "t2",
    startDate: "2026-06-06",
    endDate: "2026-06-06",
    hoursPerDay: 4,
    status: "confirmed",
    ignoreWeekends: true,
  });
  d.closures.push(
    {
      id: "company-wednesday",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      name: "Company shutdown",
      startDate: "2026-06-03",
      endDate: "2026-06-03",
    },
    {
      id: "company-saturday",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      name: "Weekend shutdown",
      startDate: "2026-06-06",
      endDate: "2026-06-06",
    },
  );
  d.timeOff.push({
    id: "personal-r1-wednesday",
    accountId: "acct-test",
    createdAt: "t",
    updatedAt: "t",
    resourceId: "r1",
    startDate: "2026-06-03",
    endDate: "2026-06-03",
    type: "holiday",
  });
  return d;
}

function buildCompanyClosureModel(blocksMode = false) {
  return buildSchedulerModel({
    data: buildCompanyClosureData(),
    geom,
    days,
    visibleWindow: { start, end },
    overSoonWindow: { start, end },
    filters: buildEmptyFilters(),
    preferences: {
      disciplinesEnabled: true,
      placeholdersEnabled: true,
      externalEnabled: true,
      blocksMode,
    },
  });
}

function registerCompanyClosureTests() {
  registerMovedSchedulerTests23811(buildCompanyClosureData, buildCompanyClosureModel);
  registerMovedSchedulerTests23812(buildCompanyClosureModel);
  registerMovedSchedulerTests23813(buildCompanyClosureModel);
}

function registerMutationTestingGapFillMiddleTests() {
  describe("company closures", registerCompanyClosureTests);
  registerMovedSchedulerTests201011();
  registerMovedSchedulerTests201012();
  registerMovedSchedulerTests201013(
    buildDanglingActivityData,
    assertDanglingActivityFiltersDoNotThrow,
    buildDanglingActivityModel,
  );
  registerMovedSchedulerTests201014();
  registerMovedSchedulerTests201015();
  registerMovedSchedulerTests201016();
  registerMovedSchedulerTests201017();
  registerMovedSchedulerTests201018();
  registerMovedSchedulerTests201019();
  registerMovedSchedulerTests201020();
}

describe("buildSchedulerModel — mutation-testing gap-fill", registerMutationTestingGapFillMiddleTests);
