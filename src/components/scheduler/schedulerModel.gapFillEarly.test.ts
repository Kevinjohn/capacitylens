import { describe, expect, it } from "vitest";
import { buildEmptyFilters } from "../../store/useStore";
import { makeAllocation, makeResource, requireValue } from "../../test/fixtures";
import { buildSchedulerModel } from "./schedulerModel";
import { allBars, build, dataset, days, end, geom, start } from "./schedulerModel.testSupport";

function buildBlockTimeOffRows() {
  const d = dataset();
  d.allocations = [
    {
      ...requireValue(d.allocations[0], "a1 allocation"),
      startDate: "2026-06-01",
      endDate: "2026-06-07",
      hoursPerDay: 8, // legacy load is retained in storage but projected to zero in Blocks mode
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
      accountWorkingDays: [1, 2, 3, 4], // Friday is globally closed; Sat/Sun are personally closed.
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

// Mutation-testing gap-fill: each block below targets a specific line the exhaustive suites above
// happen not to exercise in a way that observes real output (a fallback path, an optional-chain
// guard, a Map built via array-pair entries, etc).
function registerMovedSchedulerTests20101() {
  it("search is TRIMMED before matching (leading/trailing whitespace is not part of the term)", () => {
    const d = dataset();
    // A resource whose displayName/name/role all collapse to the SAME single word, so there's no
    // duplicate occurrence anywhere in the searched string to coincidentally rescue an un-trimmed
    // search — the only way 'zed ' (trailing space) matches is if it's trimmed to 'zed' first.
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
    delete resourceWithoutName.name;
    d.resources[0] = resourceWithoutName;
    // Searching for a term that would only ever match via a bogus non-empty fallback string.
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
    expect(a1.client).toBe("Acme");
  });
}

function registerMovedSchedulerTests20105() {
  it("an internal activity is grey by default and palette mode restores the RESOURCE colour", () => {
    const d = dataset();
    d.activities.push({
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

    const paletteModel = buildSchedulerModel({
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
        blocksMode: false,
        internalColourMode: "palette",
      },
    });
    const paletteBar = requireValue(
      allBars(paletteModel).find((b) => b.allocation.id === "a-int"),
      "internal bar",
    );
    expect(paletteBar.color).toBe("#4");
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
    // TWO time-off rows for the SAME resource, so the resourceId -> TimeOff[] map must accumulate
    // (push into an existing bucket) rather than each write clobbering the last one.
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
    expect(r1.timeOff).toHaveLength(2); // both accumulate — neither write drops the other
    const t1 = requireValue(
      r1.timeOff.find((t) => t.id === "to1"),
      "to1 time-off block",
    );
    expect(t1.x).toBe(geom.xForDateInGeom("2026-06-01"));
    expect(t1.width).toBe(geom.widthForDates("2026-06-01", "2026-06-01"));
    expect(t1.note).toBe("day one");
    expect(typeof t1.label).toBe("string");
    expect(t1.label.length).toBeGreaterThan(0);
    // Day-state unavailable is exactly cap.available === 0: true on the time-off day, false on a
    // plain working day with no time off (2026-06-03, a Wednesday r1 works).
    expect(r1.dayStates[0]?.unavailable).toBe(true); // 2026-06-01, on time off
    expect(r1.dayStates[2]?.unavailable).toBe(false); // 2026-06-03, ordinary working day
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
      id: "to-r1-monday",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      resourceId: "r1",
      startDate: "2026-06-01",
      endDate: "2026-06-01",
      type: "holiday",
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

    // Monday's time off and globally closed Friday stay fully unavailable. Tuesday is the only
    // saved half day that retains 4h capacity; ordinary full days and the weekend stay unmarked.
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
    // a1 spans Mon–Tue at exactly 8h/day. Monday remains at capacity; Tuesday has zero available
    // hours because of time off and therefore becomes the sole over day. r2's Wednesday holiday has
    // no allocation and must stay non-red.
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
    expect(r1.dayStates[4]).toMatchObject({ unavailable: true, timeOffConflict: false }); // global Friday
    expect(r1.dayStates[5]).toMatchObject({ unavailable: true, timeOffConflict: false }); // personal Saturday
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
