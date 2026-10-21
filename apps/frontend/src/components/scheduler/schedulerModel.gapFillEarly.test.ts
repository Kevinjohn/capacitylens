import { NULLABLE_FIELDS } from "@capacitylens/shared/types/nullableFields";
import { describe, expect, it } from "vitest";
import { buildEmptyFilters } from "@/store/useStore";
import { makeAllocation, makeResource, requireValue } from "@/test/fixtures";
import { buildSchedulerModel } from "./schedulerModel";
import { allBars, build, dataset, days, end, geom, start } from "./schedulerModel.testSupport";

function buildBlockTimeOffRows() {
  const d = dataset();
  d.allocations = [
    {
      ...requireValue(d.allocations[0], "a1 allocation"),
      startDate: "2026-06-01",
      endDate: "2026-06-07",
      hoursPerDay: 8,
    },
  ];
  d.timeOff = [
    {
      id: "to-r1-tuesday",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      resourceId: "r1",
      startDate: "2026-06-02",
      endDate: "2026-06-02",
      type: "holiday",
      note: null,
    },
    {
      id: "to-r2-wednesday",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      resourceId: "r2",
      startDate: "2026-06-03",
      endDate: "2026-06-03",
      type: "holiday",
      note: null,
    },
  ];

  const model = buildSchedulerModel({
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

      accountWorkingDays: [1, 2, 3, 4],
      blocksMode: true,
    },
  });
  const rows = model.flatMap((group) => group.rows);
  const r1 = requireValue(
    rows.find((row) => row.resource.id === "r1"),
    "r1 scheduler row",
  );
  const r2 = requireValue(
    rows.find((row) => row.resource.id === "r2"),
    "r2 scheduler row",
  );

  return { r1, r2 };
}

function registerMovedSchedulerTests20101() {
  it("search is TRIMMED before matching (leading/trailing whitespace is not part of the term)", () => {
    const d = dataset();
    // Use a single-occurrence search term so a duplicate name or role cannot accidentally rescue an untrimmed query.
    d.resources.push(
      makeResource({
        id: "r-zed",
        accountId: "acct-test",
        name: "Zed",
        role: "Zed",
        disciplineId: "d-design",
        color: "#a",
      }),
    );
    const model = buildSchedulerModel({
      data: d,
      geom: geom,
      days: days,
      visibleWindow: { start: start, end: end },
      overSoonWindow: { start: start, end: end },
      filters: { ...buildEmptyFilters(), search: "zed " },
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    });
    const ids = model.flatMap((g) => g.rows).map((r) => r.resource.id);
    expect(ids).toContain("r-zed");
  });
}

function registerMovedSchedulerTests20102() {
  it("search falls back to an EMPTY string (not a literal placeholder) when resource.name is undefined", () => {
    const d = dataset();
    const firstResource = d.resources[0];
    expect(firstResource).toBeDefined();
    if (!firstResource) throw new Error("Expected the base scheduler resource.");
    const resourceWithoutName = { ...firstResource };
    resourceWithoutName.name = null;
    d.resources[0] = resourceWithoutName;

    const model = buildSchedulerModel({
      data: d,
      geom: geom,
      days: days,
      visibleWindow: { start: start, end: end },
      overSoonWindow: { start: start, end: end },
      filters: { ...buildEmptyFilters(), search: "stryker" },
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    });
    expect(model.flatMap((g) => g.rows).map((r) => r.resource.id)).not.toContain("r1");
  });
}

function registerMovedSchedulerTests20103() {
  it("a placeholder IS searchable by its own (unusual, but allowed) `name` field", () => {
    const d = dataset();
    d.resources.push(
      makeResource({
        id: "ph-named",
        accountId: "acct-test",
        kind: "placeholder",
        name: "Zibblequork",
        role: "Designer",
        disciplineId: "d-design",
        color: "#b",
      }),
    );
    const model = buildSchedulerModel({
      data: d,
      geom: geom,
      days: days,
      visibleWindow: { start: start, end: end },
      overSoonWindow: { start: start, end: end },
      filters: { ...buildEmptyFilters(), search: "zibblequork" },
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    });
    expect(model.flatMap((g) => g.rows).map((r) => r.resource.id)).toContain("ph-named");
  });
}

function registerMovedSchedulerTests20104() {
  it("bar.project / bar.client resolve through the projectById / clientById maps (real lookups, not empty maps)", () => {
    const model = build();
    const a1 = requireValue(
      allBars(model).find((b) => b.allocation.id === "a1"),
      "a1 bar",
    );
    expect(a1.project).toBe("P1");
    expect(a1.client).toBe("Ferris");
  });
}

function registerMovedSchedulerTests20105() {
  it("an internal activity bar is always neutral grey", () => {
    const d = dataset();
    d.activities.push({
      ...NULLABLE_FIELDS.activities,
      id: "t-int",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      name: "Admin",
      kind: "internal",
    });
    d.allocations.push(
      makeAllocation({
        id: "a-int",
        accountId: "acct-test",
        activityId: "t-int",
        startDate: "2026-06-05",
        endDate: "2026-06-05",
      }),
    );
    const greyModel = buildSchedulerModel({
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
    const greyBar = requireValue(
      allBars(greyModel).find((b) => b.allocation.id === "a-int"),
      "internal bar",
    );
    expect(greyBar.color).toBe("#9ca3af");
  });
}

function registerMovedSchedulerTests20106() {
  it("does not throw when there are no clients at all (scopedAccountId derivation is optional-chained)", () => {
    const d = { ...dataset(), clients: [] };
    expect(() =>
      buildSchedulerModel({
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
      }),
    ).not.toThrow();
  });
}

function registerMovedSchedulerTests20107() {
  it("positions time-off blocks with real fields (id/x/width/label/note), and marks only its OWN days unavailable", () => {
    const d = dataset();
    // Time-off indexing must accumulate all entries for a resource rather than replace earlier entries.
    d.timeOff.push(
      {
        id: "to1",
        accountId: "acct-test",
        createdAt: "t",
        updatedAt: "t",
        resourceId: "r1",
        startDate: "2026-06-01",
        endDate: "2026-06-01",
        type: "holiday",
        note: "day one",
      },
      {
        id: "to2",
        accountId: "acct-test",
        createdAt: "t",
        updatedAt: "t",
        resourceId: "r1",
        startDate: "2026-06-02",
        endDate: "2026-06-02",
        type: "sick",
        note: null,
      },
    );
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
    const r1 = requireValue(
      model.flatMap((g) => g.rows).find((r) => r.resource.id === "r1"),
      "r1 scheduler row",
    );
    expect(r1.timeOff).toHaveLength(2);
    const t1 = requireValue(
      r1.timeOff.find((t) => t.id === "to1"),
      "to1 time-off block",
    );
    expect(t1.x).toBe(geom.xForDateInGeom("2026-06-01"));
    expect(t1.width).toBe(geom.widthForDates("2026-06-01", "2026-06-01"));
    expect(t1.note).toBe("day one");
    expect(typeof t1.label).toBe("string");
    expect(t1.label.length).toBeGreaterThan(0);

    expect(r1.dayStates[0]?.unavailable).toBe(true);

    expect(r1.dayStates[2]?.unavailable).toBe(false);
  });
}

function registerMovedSchedulerTests20108() {
  it("signals saved half days only when the date retains partial capacity", () => {
    const d = dataset();
    const resource = requireValue(
      d.resources.find((candidate) => candidate.id === "r1"),
      "r1 resource",
    );
    resource.halfDays = [1, 2, 5];
    d.timeOff.push({
      ...NULLABLE_FIELDS.timeOff,
      id: "to-r1-monday",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      resourceId: "r1",
      startDate: "2026-06-01",
      endDate: "2026-06-01",
      type: "holiday",
      note: null,
    });

    const row = requireValue(
      buildSchedulerModel({
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
          accountWorkingDays: [1, 2, 3, 4],
        },
      })
        .flatMap((group) => group.rows)
        .find((candidate) => candidate.resource.id === "r1"),
      "r1 scheduler row",
    );

    expect(row.dayStates.map((state) => state.partialCapacity)).toEqual([
      false,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(row.dayStates[0]).toMatchObject({ unavailable: true, partialCapacity: false });
    expect(row.dayStates[1]).toMatchObject({ unavailable: false, partialCapacity: true, over: true });
    expect(row.dayStates[4]).toMatchObject({ unavailable: true, partialCapacity: false });
  });
}

function registerMovedSchedulerTests20109() {
  it("marks only the holiday day of a partial allocation overlap as over", () => {
    const d = dataset();

    d.timeOff.push(
      {
        id: "to-r1-tuesday",
        accountId: "acct-test",
        createdAt: "t",
        updatedAt: "t",
        resourceId: "r1",
        startDate: "2026-06-02",
        endDate: "2026-06-02",
        type: "holiday",
        note: null,
      },
      {
        id: "to-r2-wednesday",
        accountId: "acct-test",
        createdAt: "t",
        updatedAt: "t",
        resourceId: "r2",
        startDate: "2026-06-03",
        endDate: "2026-06-03",
        type: "holiday",
        note: null,
      },
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
    const rows = model.flatMap((group) => group.rows);
    const r1 = requireValue(
      rows.find((row) => row.resource.id === "r1"),
      "r1 scheduler row",
    );
    const r2 = requireValue(
      rows.find((row) => row.resource.id === "r2"),
      "r2 scheduler row",
    );

    expect(r1.dayStates.map((state) => state.over)).toEqual([false, true, false, false, false, false, false]);
    expect(r1.dayStates.map((state) => state.timeOffConflict)).toEqual([
      false,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(r1.timeOff).toHaveLength(1);
    expect(r2.dayStates[2]).toMatchObject({ unavailable: true, over: false, timeOffConflict: false });
  });
}

function registerMovedSchedulerTests201010() {
  it("marks only block/time-off overlaps without adding load or treating non-working days as conflicts", () => {
    const { r1, r2 } = buildBlockTimeOffRows();

    expect(r1.dayStates.map((state) => state.over)).toEqual([false, false, false, false, false, false, false]);
    expect(r1.dayStates.map((state) => state.timeOffConflict)).toEqual([
      false,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(r1.dayStates[4]).toMatchObject({ unavailable: true, timeOffConflict: false });
    expect(r1.dayStates[5]).toMatchObject({ unavailable: true, timeOffConflict: false });
    expect(r1.utilization).toBe(0);
    expect(r1.overSoon).toBe(false);
    expect(r2.dayStates[2]).toMatchObject({ unavailable: true, over: false, timeOffConflict: false });
  });
}

function registerMutationTestingGapFillEarlyTests() {
  registerMovedSchedulerTests20101();
  registerMovedSchedulerTests20102();
  registerMovedSchedulerTests20103();
  registerMovedSchedulerTests20104();
  registerMovedSchedulerTests20105();
  registerMovedSchedulerTests20106();
  registerMovedSchedulerTests20107();
  registerMovedSchedulerTests20108();
  registerMovedSchedulerTests20109();
  registerMovedSchedulerTests201010();
}

describe("buildSchedulerModel — mutation-testing gap-fill", registerMutationTestingGapFillEarlyTests);
