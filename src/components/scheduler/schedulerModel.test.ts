import { describe, it, expect, vi } from "vitest";
import { buildSchedulerModel, applyVisibleUtilization, type GroupModel } from "./schedulerModel";
import { buildColumnGeometry } from "./columnGeometry";
import { eachDayISO, addDaysISO } from "@capacitylens/shared/lib/dateMath";
import { buildEmptyFilters } from "../../store/useStore";
import { activeOnly } from "@capacitylens/shared/domain/lifecycle";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { AppData, ISODate, Weekday } from "@capacitylens/shared/types/entities";
import { hasRenderableDateRange } from "./schedulerModelIndexing";
import { makeActivity, makeAllocation, makeClient, makeProject, makeResource, requireValue } from "../../test/fixtures";
import {
  DEFAULT_ACCOUNT_WORKING_DAYS,
  allBars,
  build,
  capacityForWindowOf,
  dataset as buildDataset,
  days,
  end,
  geom,
  start,
  withExternal,
} from "./schedulerModel.testSupport";

function makeDisciplines(): AppData["disciplines"] {
  return [
    {
      id: "d-design",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      name: "Design",
      sortOrder: 0,
    },
    {
      id: "d-dev",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      name: "Development",
      sortOrder: 1,
    },
  ];
}

const dataset = () => buildDataset(makeDisciplines());

const barIds = (model: GroupModel[]) =>
  allBars(model)
    .map((b) => b.allocation.id)
    .sort();

function buildCompanyWorkingWeekRow(data: AppData, accountWorkingDays: Weekday[]) {
  return requireValue(
    buildSchedulerModel({
      data,
      geom,
      days,
      visibleWindow: { start, end },
      overSoonWindow: { start, end },
      filters: buildEmptyFilters(),
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
        accountWorkingDays,
      },
    })
      .flatMap((group) => group.rows)
      .find((candidate) => candidate.resource.id === "r1"),
    "r1 scheduler row",
  );
}

describe("#257 characterization: company-off tint/capacity agreement", () => {
  // Flipped in Phase 3: company closure now also zeroes scheduled and available capacity.
  it("tints a company-closed Friday unavailable with zero available capacity", () => {
    const data = dataset();
    const resource = requireValue(
      data.resources.find((candidate) => candidate.id === "r1"),
      "r1 resource",
    );
    const row = buildCompanyWorkingWeekRow(data, [1, 2, 3, 4]);
    const fridayCapacity = requireValue(
      capacityForWindowOf({
        resource,
        allocations: data.allocations.filter((allocation) => allocation.resourceId === resource.id),
        timeOff: [],
        windowStart: "2026-06-05",
        windowEnd: "2026-06-05",
        accountWorkingDays: [1, 2, 3, 4],
      })[0],
      "Friday capacity",
    );

    expect(row.dayStates[4]).toMatchObject({ unavailable: true, creationBlocked: true });
    expect(fridayCapacity.available).toBe(0);
  });

  it("marks every visible day creation-blocked for a resource with no effective working week", () => {
    const data = dataset();
    const row = buildCompanyWorkingWeekRow(data, [0]);

    expect(row.dayStates).toHaveLength(days.length);
    expect(row.dayStates.every(({ creationBlocked }) => creationBlocked)).toBe(true);
  });

  it("suppresses a saved Friday half-day tint when Friday is company-closed", () => {
    const data = dataset();
    data.resources = data.resources.map((resource) =>
      resource.id === "r1" ? { ...resource, halfDays: [5] } : resource,
    );
    const row = buildCompanyWorkingWeekRow(data, [1, 2, 3, 4]);

    expect(row.dayStates[4]).toMatchObject({ unavailable: true, partialCapacity: false });
  });
});

function makeEngagementOrderingData(): AppData {
  const data = dataset();
  const designTemplate = requireValue(data.resources[0], "design resource template");
  data.resources = [
    { ...designTemplate, id: "design-alpha", name: "Alpha" },
    {
      ...designTemplate,
      id: "design-zulu",
      name: "Zulu",
      engagement: "supplementary",
      isFavourite: true,
    },
    { ...designTemplate, id: "design-beta", name: "Beta", isFavourite: true },
    {
      ...designTemplate,
      id: "design-gamma",
      name: "Gamma",
      engagement: "supplementary",
    },
    requireValue(data.resources[1], "development resource"),
    {
      ...designTemplate,
      id: "external-alpha",
      kind: "external",
      name: "Acme",
      role: "Print",
    },
    {
      ...designTemplate,
      id: "external-zulu",
      kind: "external",
      name: "Zeta",
      role: "Studio",
      isFavourite: true,
    },
  ];
  return data;
}

it("keeps discipline groups while ordering engagement partitions and externals deterministically", () => {
  const data = makeEngagementOrderingData();

  const model = buildSchedulerModel({
    data,
    geom,
    days,
    visibleWindow: { start, end },
    overSoonWindow: { start, end },
    filters: buildEmptyFilters(),
    preferences: { disciplinesEnabled: true, placeholdersEnabled: true, externalEnabled: true },
  });

  expect(model.map((group) => group.key)).toEqual(["d-design", "d-dev", "external"]);
  expect(requireValue(model[0], "design group").rows.map((row) => row.resource.name)).toEqual([
    "Beta",
    "Alpha",
    "Zulu",
    "Gamma",
  ]);
  expect(requireValue(model[2], "external group").rows.map((row) => row.resource.name)).toEqual(["Zeta", "Acme"]);

  const ungroupedByEngagement = buildSchedulerModel({
    data,
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
  expect(requireValue(ungroupedByEngagement[0], "ungrouped design group").rows.map((row) => row.resource.name)).toEqual(
    ["Beta", "Zulu", "Alpha", "Gamma"],
  );
});

// dataset() + one external party booked on a project activity over a weekend (zero-capacity for a
// person), plus a stray time-off row — to prove externals carry NO capacity signals at all.

function registerBuildSchedulerModelTest1() {
  it("groups by discipline and positions bars (no filters)", () => {
    const model = build();
    expect(model.map((g) => g.title)).toEqual(["Design", "Development"]);
    expect(barIds(model)).toEqual(["a1", "a2", "a3"]);
    const a1 = requireValue(
      allBars(model).find((b) => b.allocation.id === "a1"),
      "a1 bar",
    );
    expect(a1.x).toBe(0); // origin === start
    expect(a1.width).toBe(96); // 2 inclusive days * 48
  });
}

function registerBuildSchedulerModelTest2() {
  it("surfaces the last surviving linked-series end without inferring legacy repeats", () => {
    const data = dataset();
    data.allocations = [
      { ...requireValue(data.allocations[0], "a1 allocation"), seriesId: "series-1", endDate: "2026-06-02" },
      {
        ...requireValue(data.allocations[0], "a1 allocation"),
        id: "series-later",
        seriesId: "series-1",
        startDate: "2026-08-10",
        endDate: "2026-08-12",
      },
      { ...requireValue(data.allocations[1], "a2 allocation"), id: "legacy-repeat" },
    ];
    const model = buildSchedulerModel({
      data,
      geom,
      days,
      visibleWindow: { start, end },
      overSoonWindow: { start, end },
      filters: buildEmptyFilters(),
      preferences: { disciplinesEnabled: true, placeholdersEnabled: true, externalEnabled: true },
    });

    expect(allBars(model).find((bar) => bar.allocation.id === "a1")?.seriesEnd).toBe("2026-08-12");
    const legacyRepeat = allBars(model).find((bar) => bar.allocation.id === "legacy-repeat");
    expect(legacyRepeat).toBeDefined();
    expect(legacyRepeat).not.toHaveProperty("seriesEnd");
  });
}

function registerBuildSchedulerModelTest3() {
  it("orders people before placeholders within a discipline (regardless of data order)", () => {
    const d = dataset();
    // A placeholder listed BEFORE a person in the same discipline — the model must
    // still surface the person first.
    d.resources = [
      makeResource({
        id: "ph",
        accountId: "acct-test",
        kind: "placeholder",
        role: "Designer",
        disciplineId: "d-design",
        color: "#9",
      }),
      ...d.resources, // r1 (person, Design), r2 (person, Dev)
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
    expect(design.rows.map((r) => r.resource.id)).toEqual(["r1", "ph"]);
  });
}

function registerBuildSchedulerModelTest4(withPlaceholder: () => AppData) {
  it("placeholdersEnabled OFF hides placeholder rows + their bars across the model", () => {
    const off = buildSchedulerModel({
      data: withPlaceholder(),
      geom: geom,
      days: days,
      visibleWindow: { start: start, end: end },
      overSoonWindow: { start: start, end: end },
      filters: buildEmptyFilters(),
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: false,
        externalEnabled: true,
      },
    });
    const ids = off.flatMap((g) => g.rows).map((r) => r.resource.id);
    expect(ids).not.toContain("ph");
    // The placeholder's allocation is unreferenced, not errored — no bar for it anywhere.
    expect(allBars(off).map((b) => b.allocation.id)).not.toContain("a-ph");
  });
}

function registerBuildSchedulerModelTest5(withPlaceholder: () => AppData) {
  it("placeholdersEnabled ON shows the placeholder row with its bar", () => {
    const on = buildSchedulerModel({
      data: withPlaceholder(),
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
    const ids = on.flatMap((g) => g.rows).map((r) => r.resource.id);
    expect(ids).toContain("ph");
    expect(allBars(on).map((b) => b.allocation.id)).toContain("a-ph");
  });
}

function registerBuildSchedulerModelTest6(withPlaceholder: () => AppData) {
  it("placeholdersEnabled OFF excludes placeholders from per-discipline utilisation", () => {
    // Per-discipline utilisation is the mean of row.utilization over group.rows (SchedulerGrid).
    // The Design discipline holds r1 (a person) and ph (a placeholder); a hidden placeholder is
    // simply absent from group.rows, so its load can't leak into the discipline average.
    const off = buildSchedulerModel({
      data: withPlaceholder(),
      geom: geom,
      days: days,
      visibleWindow: { start: start, end: end },
      overSoonWindow: { start: start, end: end },
      filters: buildEmptyFilters(),
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: false,
        externalEnabled: true,
      },
    });
    const on = buildSchedulerModel({
      data: withPlaceholder(),
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
    const avg = (rows: { utilization: number }[]) => rows.reduce((s, r) => s + r.utilization, 0) / rows.length;
    const designOff = requireValue(
      off.find((g) => g.title === "Design"),
      "Design group with placeholders hidden",
    );
    const designOn = requireValue(
      on.find((g) => g.title === "Design"),
      "Design group with placeholders shown",
    );
    // The placeholder is fully booked over the window while r1 is lighter, so including it (ON)
    // raises the discipline average above the placeholders-OFF figure.
    expect(avg(designOn.rows)).toBeGreaterThan(avg(designOff.rows));
    // And OFF the discipline has only the one person row.
    expect(designOff.rows.map((r) => r.resource.id)).toEqual(["r1"]);
  });
}

function registerBuildSchedulerModelTest7() {
  it("hideTentative removes tentative bars, but capacity/utilisation still count them", () => {
    const model = build({ filters: { ...buildEmptyFilters(), hideTentative: true } });
    expect(barIds(model)).toEqual(["a1", "a3"]);
    const r1 = requireValue(
      model.flatMap((g) => g.rows).find((r) => r.resource.id === "r1"),
      "r1 scheduler row",
    );
    // a1 (8h×2) + a2 (4h×2, tentative) = 24h over 40 available -> 0.6, unaffected by the filter
    expect(r1.utilization).toBeCloseTo(0.6);
  });
}

function registerBuildSchedulerModelTest8() {
  it("displayed utilisation % follows the VISIBLE window (visStart/visEnd), not the whole timeline", () => {
    // `days` spans the full week (6/1–6/7), but the VISIBLE window passed in is just 6/3–6/4.
    // Over that window r1 has only a2 (4h × 2 working days) / (8h × 2) = 0.5. (Pre-change the %
    // ran over a fixed window decoupled from the view; now it tracks the visible span, so this
    // assertion is inverted from its old form.)
    const model = buildSchedulerModel({
      data: dataset(),
      geom: geom,
      days: days,
      visibleWindow: { start: "2026-06-03", end: "2026-06-04" },
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
    expect(r1.utilization).toBeCloseTo(0.5);
    // The visible model (bars/day-states) still covers the full `days` range, unaffected by the window.
    expect(r1.dayStates.length).toBe(days.length);
  });
}

function registerBuildSchedulerModelTest9() {
  it("overSoon stays on the FIXED forward window — independent of the visible window", () => {
    const d = dataset();
    // Stack a second 8h allocation on r1's 6/1–6/2 (8 + 8 > 8 available -> over on those days).
    d.allocations.push({
      id: "a4",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      resourceId: "r1",
      activityId: "t1",
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      hoursPerDay: 8,
      status: "confirmed",
    });
    // VISIBLE window 6/3–6/4 has NO over day, but the FIXED overSoon window 6/1–6/2 does — overSoon
    // must read the fixed window, so r1 is flagged even though the visible window is clean.
    const rows = buildSchedulerModel({
      data: d,
      geom: geom,
      days: days,
      visibleWindow: { start: "2026-06-03", end: "2026-06-04" },
      overSoonWindow: { start: "2026-06-01", end: "2026-06-02" },
      filters: buildEmptyFilters(),
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    }).flatMap((g) => g.rows);
    expect(
      requireValue(
        rows.find((r) => r.resource.id === "r1"),
        "r1 scheduler row",
      ).overSoon,
    ).toBe(true);
    expect(
      requireValue(
        rows.find((r) => r.resource.id === "r2"),
        "r2 scheduler row",
      ).overSoon,
    ).toBe(false); // 8h == 8h available, not over
  });
}

function registerBuildSchedulerModelTest10() {
  it("project filter limits bars to that project (resources still listed)", () => {
    expect(barIds(build({ filters: { ...buildEmptyFilters(), projectId: "p2" } }))).toEqual(["a2", "a3"]);
  });
}

function registerBuildSchedulerModelTest11() {
  it("refreshes visible utilisation without rebuilding static schedule rows", () => {
    const data = dataset();
    data.closures.push({
      id: "company-wednesday",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      name: "Company shutdown",
      startDate: "2026-06-03",
      endDate: "2026-06-03",
    });
    const base = buildSchedulerModel({
      data,
      geom,
      days,
      visibleWindow: { start: "2026-06-01", end: "2026-06-02" },
      overSoonWindow: { start, end },
      filters: buildEmptyFilters(),
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    });
    const refreshed = applyVisibleUtilization({
      model: base,
      data,
      start: "2026-06-03",
      end: "2026-06-05",
      accountWorkingDays: DEFAULT_ACCOUNT_WORKING_DAYS,
    });
    const rebuilt = buildSchedulerModel({
      data,
      geom,
      days,
      visibleWindow: { start: "2026-06-03", end: "2026-06-05" },
      overSoonWindow: { start, end },
      filters: buildEmptyFilters(),
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    });
    const utilisationByResource = (groups: GroupModel[]) =>
      Object.fromEntries(groups.flatMap((group) => group.rows.map((row) => [row.resource.id, row.utilization])));
    expect(utilisationByResource(refreshed)).toEqual(utilisationByResource(rebuilt));
    expect(utilisationByResource(refreshed).r1).toBe(0.25);

    const baseRow = requireValue(requireValue(base[0], "base group").rows[0], "base row");
    const refreshedRow = requireValue(requireValue(refreshed[0], "refreshed group").rows[0], "refreshed row");
    expect(refreshedRow.bars).toBe(baseRow.bars);
    expect(refreshedRow.dayStates).toBe(baseRow.dayStates);
    expect(refreshedRow.timeOff).toBe(baseRow.timeOff);
  });
}

function registerBuildSchedulerModelTest12(
  buildLens: (filters?: ReturnType<typeof buildEmptyFilters>) => GroupModel[],
) {
  it("activity lens: a specific activity id limits bars to that activity", () => {
    // Default (showUnmatched off): non-matching rows collapse out and matching rows show ONLY
    // their matching bars. (With showUnmatched on, dimmed rows show full real load by design.)
    const bars = buildLens({ ...buildEmptyFilters(), activityId: "t-rep" })
      .flatMap((g) => g.rows)
      .flatMap((r) => r.bars)
      .map((b) => b.allocation.id)
      .sort();
    expect(bars).toEqual(["a-rep"]);
  });
}

function registerBuildSchedulerModelTest13(
  buildLens: (filters?: ReturnType<typeof buildEmptyFilters>) => GroupModel[],
) {
  it('activity lens: "All projects — All" (activityKind) shows only all-projects activity allocations', () => {
    const bars = buildLens({ ...buildEmptyFilters(), activityKind: "repeatable" })
      .flatMap((g) => g.rows)
      .flatMap((r) => r.bars)
      .map((b) => b.allocation.id)
      .sort();
    expect(bars).toEqual(["a-rep"]);
  });
}

function registerBuildSchedulerModelTest14(
  buildLens: (filters?: ReturnType<typeof buildEmptyFilters>) => GroupModel[],
) {
  it('activity lens: "Internal — All" (activityKind) shows only internal-activity allocations', () => {
    const bars = buildLens({ ...buildEmptyFilters(), activityKind: "internal" })
      .flatMap((g) => g.rows)
      .flatMap((r) => r.bars)
      .map((b) => b.allocation.id)
      .sort();
    expect(bars).toEqual(["a-int"]);
  });
}

function registerBuildSchedulerModelTest15(
  buildLens: (filters?: ReturnType<typeof buildEmptyFilters>) => GroupModel[],
) {
  it("activity lens: dims (and by default hides) rows with no work on the filtered activity", () => {
    // activityKind 'repeatable' matches only r2's a-rep. By default (showUnmatched off) r1 collapses out.
    const rows = buildLens({
      ...buildEmptyFilters(),
      activityKind: "repeatable",
    }).flatMap((g) => g.rows);
    expect(rows.map((r) => r.resource.id)).toEqual(["r2"]);
  });
}

function registerBuildSchedulerModelTest16() {
  it("dims (not hides) a resource with no work on the active project when showUnmatched is opted in", () => {
    // r1 works on p1; r2 has only p2 work → with showUnmatched on, r2 is dimmed but
    // still shown (its a3 bar) so you can see it's available to staff onto p1.
    const rows = build({
      filters: {
        ...buildEmptyFilters(),
        projectId: "p1",
        showUnmatched: true,
      },
    }).flatMap((g) => g.rows);
    expect(
      requireValue(
        rows.find((r) => r.resource.id === "r1"),
        "r1 scheduler row",
      ).dimmed,
    ).toBe(false);
    const r2 = requireValue(
      rows.find((r) => r.resource.id === "r2"),
      "r2 scheduler row",
    );
    expect(r2.dimmed).toBe(true);
    expect(r2.bars.map((b) => b.allocation.id)).toEqual(["a3"]);
  });
}

function registerBuildSchedulerModelTest17() {
  it("hides the unmatched (unallocated) rows by default", () => {
    // emptyFilters() ships showUnmatched: false — filtering collapses to matching rows.
    const rows = build({ filters: { ...buildEmptyFilters(), projectId: "p1" } }).flatMap((g) => g.rows);
    expect(rows.map((r) => r.resource.id)).toEqual(["r1"]);
  });
}

function registerBuildSchedulerModelTest18() {
  it("does not leave a full-opacity zero-bar ghost row when the only match is a hidden tentative allocation", () => {
    // r1's only p2 work (a2) is tentative; with hideTentative it's hidden, so r1 has no
    // VISIBLE match. It must be treated as unmatched (dimmed) — and filtered out when
    // showUnmatched is off — not rendered as a full-opacity row with zero bars.
    const filters = {
      ...buildEmptyFilters(),
      projectId: "p2",
      hideTentative: true,
      showUnmatched: false,
    };
    const rows = build({ filters }).flatMap((g) => g.rows);
    expect(rows.map((r) => r.resource.id)).toEqual(["r2"]); // r1 filtered out, not a ghost
    expect(rows.every((r) => r.dimmed || r.bars.length > 0)).toBe(true); // no non-dimmed zero-bar row
  });
}

function registerBuildSchedulerModelTest19() {
  it("does not treat off-timeline matching work as a visible filter match", () => {
    const d = dataset();
    const offTimeline = requireValue(
      d.allocations.find((allocation) => allocation.id === "a1"),
      "a1 allocation",
    );
    offTimeline.startDate = "2035-01-01";
    offTimeline.endDate = "2035-01-02";
    const filtered = buildSchedulerModel({
      data: d,
      geom: geom,
      days: days,
      visibleWindow: { start: start, end: end },
      overSoonWindow: { start: start, end: end },
      filters: { ...buildEmptyFilters(), projectId: "p1", showUnmatched: false },
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    });

    expect(filtered.flatMap((group) => group.rows)).toHaveLength(0);

    const staffing = buildSchedulerModel({
      data: d,
      geom: geom,
      days: days,
      visibleWindow: { start: start, end: end },
      overSoonWindow: { start: start, end: end },
      filters: { ...buildEmptyFilters(), projectId: "p1", showUnmatched: true },
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    });
    const r1 = requireValue(
      staffing.flatMap((group) => group.rows).find((row) => row.resource.id === "r1"),
      "r1 staffing row",
    );
    expect(r1.dimmed).toBe(true);
    expect(r1.bars.map((bar) => bar.allocation.id)).toEqual(["a2"]);
  });
}

function registerBuildSchedulerModelTest20() {
  it("dims (showing real load) a tentative-only-match row when showUnmatched is on", () => {
    const filters = {
      ...buildEmptyFilters(),
      projectId: "p2",
      hideTentative: true,
      showUnmatched: true,
    };
    const r1 = requireValue(
      build({ filters })
        .flatMap((g) => g.rows)
        .find((r) => r.resource.id === "r1"),
      "r1 scheduler row",
    );
    expect(r1.dimmed).toBe(true); // its only p2 work is hidden → dimmed, not full-opacity
    expect(r1.bars.map((b) => b.allocation.id)).toEqual(["a1"]); // shows its real non-tentative load
  });
}

function registerBuildSchedulerModelTest21() {
  it("discipline filter drops other groups", () => {
    const model = build({ filters: { ...buildEmptyFilters(), disciplineId: "d-dev" } });
    expect(model.map((g) => g.title)).toEqual(["Development"]);
    expect(barIds(model)).toEqual(["a3"]);
  });
}

function registerBuildSchedulerModelTest22() {
  it("search narrows to matching resources and drops now-empty groups", () => {
    const model = build({ filters: { ...buildEmptyFilters(), search: "dev sam" } });
    expect(model.map((g) => g.title)).toEqual(["Development"]);
  });
}

function registerBuildSchedulerModelTest23() {
  it("reports and omits corrupt schedule ranges instead of rendering focusable slivers", () => {
    const d = dataset();
    const firstAllocation = d.allocations[0];
    const firstResource = d.resources[0];
    expect(firstAllocation).toBeDefined();
    expect(firstResource).toBeDefined();
    if (!firstAllocation || !firstResource) throw new Error("Expected the base scheduler fixture rows.");
    const corrupt = { ...firstAllocation, startDate: "2026-6-1" };
    d.allocations[0] = corrupt;
    const corruptTimeOff = {
      id: "corrupt-time-off",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      resourceId: firstResource.id,
      startDate: "2026-06-03",
      endDate: "not-a-date",
      type: "holiday" as const,
    };
    d.timeOff.push(corruptTimeOff);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(hasRenderableDateRange(corrupt)).toBe(false);
    expect(error).not.toHaveBeenCalled();
    const buildCorrupt = () =>
      buildSchedulerModel({
        data: d,
        geom,
        days,
        visibleWindow: { start, end },
        overSoonWindow: { start, end },
        filters: buildEmptyFilters(),
        preferences: { disciplinesEnabled: true, placeholdersEnabled: true, externalEnabled: true },
      });

    const first = buildCorrupt();
    buildCorrupt();

    expect(
      first.flatMap((group) => group.rows).flatMap((row) => row.bars.map((bar) => bar.allocation.id)),
    ).not.toContain(corrupt.id);
    expect(first.flatMap((group) => group.rows).flatMap((row) => row.timeOff.map((block) => block.id))).not.toContain(
      corruptTimeOff.id,
    );
    expect(error).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith(`Scheduler omitted ${corrupt.id}: invalid date range.`);
    expect(error).toHaveBeenCalledWith(`Scheduler omitted ${corruptTimeOff.id}: invalid date range.`);
  });
}

function registerBuildSchedulerModelTest24() {
  it("folds resource-name diacritics but does not match a phrase across field boundaries", () => {
    const d = dataset();
    const firstResource = d.resources[0];
    expect(firstResource).toBeDefined();
    if (!firstResource) throw new Error("Expected the base scheduler resource.");
    d.resources[0] = { ...firstResource, name: "Jose\u0301 Alvarez", role: "Research Lead" };
    const search = (query: string) =>
      buildSchedulerModel({
        data: d,
        geom,
        days,
        visibleWindow: { start, end },
        overSoonWindow: { start, end },
        filters: { ...buildEmptyFilters(), search: query },
        preferences: { disciplinesEnabled: true, placeholdersEnabled: true, externalEnabled: true },
      })
        .flatMap((group) => group.rows)
        .map((row) => row.resource.id);

    expect(search("jose alvarez")).toContain("r1");
    expect(search("alvarez research")).not.toContain("r1");
  });
}

function registerBuildSchedulerModelTest25() {
  it("disciplines off → one Studio band holds the all-Studio fixture", () => {
    const model = build({ filters: buildEmptyFilters(), disciplinesEnabled: false });
    expect(model).toHaveLength(1);
    expect(model[0]).toMatchObject({ key: "engagement-studio", title: "Studio" });
    expect(model[0]?.rows.map((r) => r.resource.id).sort()).toEqual(["r1", "r2"]);
    expect(model).toHaveLength(1);
    expect(model[0]).not.toHaveProperty("color"); // no discipline colour → avatar falls back to resource colour
    expect(barIds(model)).toEqual(["a1", "a2", "a3"]);
  });
}

function registerBuildSchedulerModelTest26() {
  it("disciplines off → the discipline filter is ignored (everyone still shown)", () => {
    const model = build({ filters: { ...buildEmptyFilters(), disciplineId: "d-dev" }, disciplinesEnabled: false });
    expect(model).toHaveLength(1);
    expect(model[0]?.title).toBe("Studio");
    expect(model[0]?.rows.map((r) => r.resource.id).sort()).toEqual(["r1", "r2"]);
  });
}

function buildPlaceholderData(): AppData {
  const d = dataset();
  d.resources.push(
    makeResource({
      id: "ph",
      accountId: "acct-test",
      kind: "placeholder",
      role: "Designer",
      disciplineId: "d-design",
      color: "#9",
      projectId: "p1",
    }),
  );
  d.allocations.push({
    id: "a-ph",
    accountId: "acct-test",
    createdAt: "t",
    updatedAt: "t",
    resourceId: "ph",
    activityId: "t1",
    startDate: "2026-06-01",
    endDate: "2026-06-05",
    hoursPerDay: 8,
    status: "confirmed",
  });
  return d;
}

function buildLensActivitiesData(): AppData {
  const d = dataset();
  d.activities.push(
    { id: "t-int", accountId: "acct-test", createdAt: "t", updatedAt: "t", name: "Admin", kind: "internal" },
    { id: "t-rep", accountId: "acct-test", createdAt: "t", updatedAt: "t", name: "Design", kind: "repeatable" },
  );
  d.allocations.push(
    {
      id: "a-int",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      resourceId: "r1",
      activityId: "t-int",
      startDate: "2026-06-05",
      endDate: "2026-06-05",
      hoursPerDay: 8,
      status: "confirmed",
    },
    {
      id: "a-rep",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      resourceId: "r2",
      activityId: "t-rep",
      startDate: "2026-06-05",
      endDate: "2026-06-05",
      hoursPerDay: 8,
      status: "confirmed",
    },
  );
  return d;
}

function registerBuildSchedulerModelTests() {
  const buildLens = (filters = buildEmptyFilters()) =>
    buildSchedulerModel({
      data: buildLensActivitiesData(),
      geom,
      days,
      visibleWindow: { start, end },
      overSoonWindow: { start, end },
      filters,
      preferences: { disciplinesEnabled: true, placeholdersEnabled: true, externalEnabled: true },
    });

  registerBuildSchedulerModelTest1();

  registerBuildSchedulerModelTest2();

  registerBuildSchedulerModelTest3();

  // dataset() + a placeholder in Design with an overbooking allocation, to prove the per-account
  // placeholdersEnabled flag hides the row AND drops its load from utilisation when off.

  registerBuildSchedulerModelTest4(buildPlaceholderData);

  registerBuildSchedulerModelTest5(buildPlaceholderData);

  registerBuildSchedulerModelTest6(buildPlaceholderData);

  registerBuildSchedulerModelTest7();

  registerBuildSchedulerModelTest8();

  registerBuildSchedulerModelTest9();

  registerBuildSchedulerModelTest10();

  registerBuildSchedulerModelTest11();

  // dataset() + project-less activities (one internal, one all-projects) with an allocation each, so the
  // activity lens has something to filter. r1 picks up an internal bar, r2 an all-projects one.

  registerBuildSchedulerModelTest12(buildLens);

  registerBuildSchedulerModelTest13(buildLens);

  registerBuildSchedulerModelTest14(buildLens);

  registerBuildSchedulerModelTest15(buildLens);

  registerBuildSchedulerModelTest16();

  registerBuildSchedulerModelTest17();

  registerBuildSchedulerModelTest18();

  registerBuildSchedulerModelTest19();

  registerBuildSchedulerModelTest20();

  registerBuildSchedulerModelTest21();

  registerBuildSchedulerModelTest22();

  registerBuildSchedulerModelTest23();

  registerBuildSchedulerModelTest24();

  registerBuildSchedulerModelTest25();

  registerBuildSchedulerModelTest26();
}

describe("buildSchedulerModel", registerBuildSchedulerModelTests);

// Visible-window utilisation: the displayed % is computed over [visStart, visEnd] and so must change
// EXACTLY with the 1/2/4/8-week range toggle. The fixture below books a different density each week so
// the four numbers genuinely differ (no coincidental equality), and an exact-span boundary booking
// proves the inclusive end (no off-by-one). A single Mon–Fri resource, 8h/day → 40h/week capacity.
function registerMovedSchedulerTests11381(utilOver: (visEnd: string) => number) {
  it("1 week → 100% (week-1 density only)", () => {
    expect(utilOver("2026-06-07")).toBeCloseTo(1.0); // 40 / 40
  });
}

function registerMovedSchedulerTests11382(utilOver: (visEnd: string) => number) {
  it("2 weeks → 75% (weeks 1–2)", () => {
    expect(utilOver("2026-06-14")).toBeCloseTo(0.75); // (40 + 20) / 80
  });
}

function registerMovedSchedulerTests11383(utilOver: (visEnd: string) => number) {
  it("4 weeks → 50% (weeks 1–4)", () => {
    expect(utilOver("2026-06-28")).toBeCloseTo(0.5); // (40 + 20 + 10 + 10) / 160
  });
}

function registerMovedSchedulerTests11384(utilOver: (visEnd: string) => number) {
  it("6 weeks → 33% (weeks 1–6, weeks 5–6 idle)", () => {
    // 6-week inclusive end = visStart 06-01 + (6×7 − 1 = 41 days) = 07-12. Booked hours are weeks 1–4
    // only (40 + 20 + 10 + 10 = 80); weeks 5–6 are unbooked. Capacity = 6 weeks × 40h = 240. 80/240.
    expect(utilOver("2026-07-12")).toBeCloseTo(1 / 3); // 80 / 240
  });
}

function registerMovedSchedulerTests11385(utilOver: (visEnd: string) => number) {
  it("8 weeks → 25% (weeks 1–8, second half idle)", () => {
    expect(utilOver("2026-07-26")).toBeCloseTo(0.25); // 80 / 320
  });
}

function registerMovedSchedulerTests11386(utilOver: (visEnd: string) => number) {
  it("the five zoom spans produce five DISTINCT numbers (the toggle genuinely recalculates)", () => {
    // One per ZOOM_LEVELS entry (1/2/4/6/8 weeks): 100 / 75 / 50 / 33 / 25.
    const nums = [
      utilOver("2026-06-07"),
      utilOver("2026-06-14"),
      utilOver("2026-06-28"),
      utilOver("2026-07-12"),
      utilOver("2026-07-26"),
    ];
    expect(new Set(nums.map((n) => Math.round(n * 100))).size).toBe(5);
  });
}

function registerMovedSchedulerTests11387(buildBoundaryModel: (id: string, allocationDate: ISODate) => GroupModel[]) {
  it("inclusive-end boundary: a booking on the visible window LAST day counts; the day AFTER does not", () => {
    // Unbooked base fixture so only the boundary booking moves the number. Window = 1 week
    // [06-01, 06-07]; capacity 40h. An 8h booking ON the last working day before/at the edge
    // counts; a booking the day AFTER the inclusive end (06-08, a Monday) is outside and excluded.
    // 06-05 (Friday) is INSIDE [06-01, 06-07]: 8h on one working day → 8 / 40 = 0.2.
    const inModel = buildBoundaryModel("in", "2026-06-05");
    expect(inModel.flatMap((g) => g.rows)[0]?.utilization).toBeCloseTo(0.2);
    // 06-08 (Monday) is the day AFTER the inclusive end → outside the window → 0%.
    const afterModel = buildBoundaryModel("af", "2026-06-08");
    expect(afterModel.flatMap((g) => g.rows)[0]?.utilization).toBe(0);
  });
}
function buildVisibleWindowDensityData(): AppData {
  return {
    ...emptyAppData(),
    clients: [makeClient({ accountId: "acct-test", name: "Acme", color: "#1" })],
    projects: [makeProject({ accountId: "acct-test", name: "P1", color: "#2" })],
    activities: [makeActivity({ accountId: "acct-test", name: "T1" })],
    resources: [makeResource({ id: "r1", accountId: "acct-test", name: "Dana", role: "Designer", color: "#4" })],
    allocations: [
      // Week 1 (06-01..06-07): 8h/day Mon–Fri → 40/40 = 100%.
      makeAllocation({
        id: "w1",
        accountId: "acct-test",
        startDate: "2026-06-01",
        endDate: "2026-06-05",
        hoursPerDay: 8,
      }),
      // Week 2 (06-08..06-14): 4h/day Mon–Fri → 20/40 = 50%.
      makeAllocation({
        id: "w2",
        accountId: "acct-test",
        startDate: "2026-06-08",
        endDate: "2026-06-12",
        hoursPerDay: 4,
      }),
      // Weeks 3–4 (06-15..06-26): 2h/day Mon–Fri → 10/40 each.
      makeAllocation({
        id: "w34",
        accountId: "acct-test",
        startDate: "2026-06-15",
        endDate: "2026-06-26",
        hoursPerDay: 2,
      }),
      // Weeks 5–8 (06-29..07-26): unbooked → 0%.
    ],
    timeOff: [],
  };
}

function registerVisibleWindowUtilisationTests() {
  const winStart = "2026-06-01";
  const winDays = eachDayISO("2026-06-01", "2026-07-26");
  const winGeom = buildColumnGeometry(winDays, 48, { minimiseWeekends: false, weekendWidth: 22 });
  const utilOver = (visEnd: string): number => {
    const model = buildSchedulerModel({
      data: buildVisibleWindowDensityData(),
      geom: winGeom,
      days: winDays,
      visibleWindow: { start: winStart, end: visEnd },
      overSoonWindow: { start: winStart, end: winStart },
      filters: buildEmptyFilters(),
      preferences: {
        disciplinesEnabled: false,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    });
    return requireValue(
      model.flatMap((g) => g.rows).find((r) => r.resource.id === "r1"),
      "r1 scheduler row",
    ).utilization;
  };

  const buildBoundaryModel = (id: string, allocationDate: ISODate) =>
    buildSchedulerModel({
      data: {
        ...buildVisibleWindowDensityData(),
        allocations: [
          makeAllocation({
            id,
            accountId: "acct-test",
            startDate: allocationDate,
            endDate: allocationDate,
          }),
        ],
      },
      geom: winGeom,
      days: winDays,
      visibleWindow: { start: winStart, end: "2026-06-07" },
      overSoonWindow: { start: winStart, end: winStart },
      filters: buildEmptyFilters(),
      preferences: {
        disciplinesEnabled: false,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    });

  // 8 weeks of timeline starting Mon 2026-06-01, anchored at the left edge (visStart = 06-01).
  // Monday
  // 8 weeks (56 days) exactly

  // Build with the visible window [winStart, visEnd], a no-op fixed overSoon window, and read r1's %.

  // Inclusive end = visStart + (zoom*7 - 1): 1w → +6, 2w → +13, 4w → +27, 8w → +55.
  registerMovedSchedulerTests11381(utilOver);
  registerMovedSchedulerTests11382(utilOver);
  registerMovedSchedulerTests11383(utilOver);
  registerMovedSchedulerTests11384(utilOver);
  registerMovedSchedulerTests11385(utilOver);
  registerMovedSchedulerTests11386(utilOver);

  registerMovedSchedulerTests11387(buildBoundaryModel);
}

describe("displayed utilisation % over the visible window (1/2/4/8 weeks)", registerVisibleWindowUtilisationTests);

function registerMovedSchedulerTests12741(
  buildExt: (
    filters?: ReturnType<typeof buildEmptyFilters>,
    disciplinesEnabled?: boolean,
    externalEnabled?: boolean,
  ) => GroupModel[],
) {
  it("renders external resources in a neutral band that is ALWAYS last", () => {
    const model = buildExt();
    // Discipline bands first, then the external band — never interleaved.
    expect(model.map((g) => g.key)).toEqual(["d-design", "d-dev", "external"]);
    const last = model[model.length - 1];
    expect(last).toBeDefined();
    if (!last) throw new Error("Expected the external resource group.");
    expect(last.title).toBe("External / 3rd party");
    expect(last.color).toBe("#9ca3af"); // NEUTRAL_COLOR
    expect(last.rows.map((r) => r.resource.id)).toEqual(["ext1"]);
  });
}

function registerMovedSchedulerTests12742(
  buildExt: (
    filters?: ReturnType<typeof buildEmptyFilters>,
    disciplinesEnabled?: boolean,
    externalEnabled?: boolean,
  ) => GroupModel[],
) {
  it("external rows carry no capacity while company-closed dates remain visibly blocked", () => {
    const ext = buildExt().at(-1)?.rows[0];
    expect(ext).toBeDefined();
    if (!ext) throw new Error("Expected the external resource row.");
    expect(ext.utilization).toBe(0);
    expect(ext.overSoon).toBe(false);
    expect(ext.dayStates.every((d) => !d.over)).toBe(true);
    expect(ext.dayStates.every((d) => !d.partialCapacity)).toBe(true);
    expect(ext.dayStates.map((d) => d.unavailable)).toEqual([false, false, false, false, false, true, true]);
    expect(ext.timeOff).toEqual([]); // the stray time-off row is ignored for externals
  });
}

function registerMovedSchedulerTests12743(
  buildExt: (
    filters?: ReturnType<typeof buildEmptyFilters>,
    disciplinesEnabled?: boolean,
    externalEnabled?: boolean,
  ) => GroupModel[],
) {
  it("external parties are still assignable — their activity bars still render", () => {
    const ext = buildExt().at(-1)?.rows[0];
    expect(ext).toBeDefined();
    if (!ext) throw new Error("Expected the external resource row.");
    expect(ext.bars.map((b) => b.allocation.id)).toEqual(["aext"]);
  });
}

function registerMovedSchedulerTests12744(
  buildExt: (
    filters?: ReturnType<typeof buildEmptyFilters>,
    disciplinesEnabled?: boolean,
    externalEnabled?: boolean,
  ) => GroupModel[],
) {
  it("disciplines off → external STILL forms its own trailing band after engagement", () => {
    const model = buildExt(buildEmptyFilters(), false);
    expect(model).toHaveLength(2); // Studio + external
    expect(model[0]?.title).toBe("Studio");
    expect(model[0]?.rows.map((r) => r.resource.id).sort()).toEqual(["r1", "r2"]);
    expect(model[1]?.key).toBe("external");
    expect(model[1]?.rows.map((r) => r.resource.id)).toEqual(["ext1"]);
  });
}

function registerMovedSchedulerTests12745(
  buildExt: (
    filters?: ReturnType<typeof buildEmptyFilters>,
    disciplinesEnabled?: boolean,
    externalEnabled?: boolean,
  ) => GroupModel[],
) {
  it("externalEnabled OFF hides external rows + their bars across the model", () => {
    const off = buildExt(buildEmptyFilters(), true, false);
    const ids = off.flatMap((g) => g.rows).map((r) => r.resource.id);
    expect(ids).not.toContain("ext1");
    // The external's allocation is unreferenced, not errored — no bar for it anywhere.
    expect(
      off
        .flatMap((g) => g.rows)
        .flatMap((r) => r.bars)
        .map((b) => b.allocation.id),
    ).not.toContain("aext");
  });
}

function registerMovedSchedulerTests12746(
  buildExt: (
    filters?: ReturnType<typeof buildEmptyFilters>,
    disciplinesEnabled?: boolean,
    externalEnabled?: boolean,
  ) => GroupModel[],
) {
  it("externalEnabled OFF drops the (now-empty) External band header entirely (risk #2)", () => {
    // The trailing external band must NOT render as an empty header when externals are hidden — the
    // model's `rows.length > 0` filter drops the whole group, so no 'external' key survives.
    const off = buildExt(buildEmptyFilters(), true, false);
    expect(off.map((g) => g.key)).not.toContain("external");
    // And with disciplines off too, only the Studio group remains (no empty external band).
    const offFlat = buildExt(buildEmptyFilters(), false, false);
    expect(offFlat.map((g) => g.key)).not.toContain("external");
    expect(offFlat).toHaveLength(1);
  });
}

function registerMovedSchedulerTests12747(
  buildExt: (
    filters?: ReturnType<typeof buildEmptyFilters>,
    disciplinesEnabled?: boolean,
    externalEnabled?: boolean,
  ) => GroupModel[],
) {
  it("externalEnabled ON shows the external row with its bar", () => {
    const on = buildExt(buildEmptyFilters(), true, true);
    expect(on.map((g) => g.key)).toContain("external");
    const ext = on.at(-1)?.rows[0];
    expect(ext).toBeDefined();
    if (!ext) throw new Error("Expected the external resource row.");
    expect(ext.resource.id).toBe("ext1");
    expect(ext.bars.map((b) => b.allocation.id)).toEqual(["aext"]);
  });
}
describe("external / 3rd-party band", () => {
  const buildExt = (filters = buildEmptyFilters(), disciplinesEnabled = true, externalEnabled = true) =>
    buildSchedulerModel({
      data: withExternal(),
      geom: geom,
      days: days,
      visibleWindow: { start: start, end: end },
      overSoonWindow: { start: start, end: end },
      filters: filters,
      preferences: {
        disciplinesEnabled: disciplinesEnabled,
        placeholdersEnabled: true,
        externalEnabled: externalEnabled,
      },
    });

  registerMovedSchedulerTests12741(buildExt);

  registerMovedSchedulerTests12742(buildExt);

  registerMovedSchedulerTests12743(buildExt);

  registerMovedSchedulerTests12744(buildExt);

  registerMovedSchedulerTests12745(buildExt);

  registerMovedSchedulerTests12746(buildExt);

  registerMovedSchedulerTests12747(buildExt);
});

// dataset() + a built-in Internal client that owns a real project (pInt), plus a project-less
// internal activity. Both bucket under Internal: filtering by the Internal client id must show
// (a) the project-less activity AND (b) the Internal-owned project's activity.
function withInternal(): AppData {
  const d = dataset();
  d.clients.push(
    makeClient({ id: "c-internal", accountId: "acct-test", name: "Internal", color: "#9c3ace", builtin: true }),
  );
  // A REAL project owned by the Internal client, with a project activity on it.
  d.projects.push(
    makeProject({ id: "pInt", accountId: "acct-test", name: "Internal Project", clientId: "c-internal", color: "#6" }),
  );
  d.activities.push(
    makeActivity({ id: "tIntProj", accountId: "acct-test", name: "Internal Proj Activity", projectId: "pInt" }),
  );
  // A project-less internal activity (derives client = Internal in the view-model).
  d.activities.push({
    id: "tIntNoProj",
    accountId: "acct-test",
    createdAt: "t",
    updatedAt: "t",
    name: "Admin",
    kind: "internal",
  });
  // r1 books both; a3 (under p1/Acme) is unrelated to Internal.
  d.allocations.push(
    makeAllocation({ id: "aIntProj", accountId: "acct-test", activityId: "tIntProj", hoursPerDay: 4 }),
    makeAllocation({
      id: "aIntNoProj",
      accountId: "acct-test",
      activityId: "tIntNoProj",
      startDate: "2026-06-03",
      endDate: "2026-06-04",
      hoursPerDay: 4,
    }),
  );
  return d;
}

function withAttributedRepeatable(): AppData {
  const d = withInternal();
  d.activities.push({
    id: "tRep",
    accountId: "acct-test",
    createdAt: "t",
    updatedAt: "t",
    name: "Design",
    kind: "repeatable",
  });
  d.allocations.push(
    {
      id: "aRepAttributed",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      resourceId: "r2",
      activityId: "tRep",
      projectId: "p1",
      startDate: "2026-06-03",
      endDate: "2026-06-03",
      hoursPerDay: 4,
      status: "confirmed",
    },
    {
      id: "aRepUnattributed",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      resourceId: "r2",
      activityId: "tRep",
      startDate: "2026-06-04",
      endDate: "2026-06-04",
      hoursPerDay: 4,
      status: "confirmed",
    },
  );
  return d;
}

describe("repeatable allocation effective project", () => {
  const buildAttributed = (filters = buildEmptyFilters()) =>
    buildSchedulerModel({
      data: withAttributedRepeatable(),
      geom,
      days,
      visibleWindow: { start, end },
      overSoonWindow: { start, end },
      filters,
      preferences: { disciplinesEnabled: true, placeholdersEnabled: true, externalEnabled: true },
    });

  it("labels and colours attributed work by its project while preserving the unattributed fallback", () => {
    const bars = allBars(buildAttributed());
    expect(bars.find((bar) => bar.allocation.id === "aRepAttributed")).toMatchObject({
      project: "P1",
      client: "Acme",
      color: "#2",
    });
    const unattributed = bars.find((bar) => bar.allocation.id === "aRepUnattributed");
    expect(unattributed).toBeDefined();
    expect(unattributed).not.toHaveProperty("project");
    expect(unattributed).toMatchObject({
      client: "Internal",
      color: "#5",
    });
  });

  it("matches attributed work through either project/client lenses or its activity lens", () => {
    const projectBars = barIds(buildAttributed({ ...buildEmptyFilters(), projectId: "p1" }));
    const clientBars = barIds(buildAttributed({ ...buildEmptyFilters(), clientId: "c1" }));
    const activityBars = barIds(buildAttributed({ ...buildEmptyFilters(), activityId: "tRep" }));

    expect(projectBars).toContain("aRepAttributed");
    expect(clientBars).toContain("aRepAttributed");
    expect(activityBars).toEqual(["aRepAttributed", "aRepUnattributed"]);
    expect(projectBars).not.toContain("aRepUnattributed");
    expect(clientBars).not.toContain("aRepUnattributed");
  });
});

function registerMovedSchedulerTests14851(
  internalId: string,
  buildInternal: (filters?: ReturnType<typeof buildEmptyFilters>) => GroupModel[],
  internalBarIds: (model: GroupModel[]) => string[],
) {
  it("filtering by the Internal client shows BOTH the project-less activity AND the Internal-owned project activity", () => {
    const model = buildInternal({ ...buildEmptyFilters(), clientId: internalId });
    // aIntProj (under the Internal-owned project pInt) + aIntNoProj (project-less, derived Internal);
    // a3 (under Acme's p1) and the other Acme work are excluded.
    expect(internalBarIds(model)).toEqual(["aIntNoProj", "aIntProj"]);
  });
}

function registerMovedSchedulerTests14852(
  buildInternal: (filters?: ReturnType<typeof buildEmptyFilters>) => GroupModel[],
  internalBarIds: (model: GroupModel[]) => string[],
) {
  it("a project-less activity is NOT shown when filtering by a different (non-Internal) client", () => {
    const model = buildInternal({ ...buildEmptyFilters(), clientId: "c1" });
    // Only Acme (c1) work — never the project-less internal activity.
    expect(internalBarIds(model)).not.toContain("aIntNoProj");
    expect(internalBarIds(model)).not.toContain("aIntProj");
  });
}

function registerMovedSchedulerTests14853(
  withInternal: () => AppData,
  internalId: string,
  internalBarIds: (model: GroupModel[]) => string[],
) {
  it("does not misclassify an activity with a dangling project reference as project-less Internal work", () => {
    const data = withInternal();
    data.projects = data.projects.filter((project) => project.id !== "pInt");
    const model = buildSchedulerModel({
      data,
      geom,
      days,
      visibleWindow: { start, end },
      overSoonWindow: { start, end },
      filters: { ...buildEmptyFilters(), clientId: internalId },
      preferences: { disciplinesEnabled: true, placeholdersEnabled: true, externalEnabled: true },
    });

    expect(internalBarIds(model)).not.toContain("aIntProj");
  });
}

function registerMovedSchedulerTests14854(withInternal: () => AppData, internalId: string) {
  it("does not bucket an unattributed dangling-activity allocation under any client or project", () => {
    const data = withInternal();
    data.allocations.push(
      {
        id: "dangling-unattributed",
        accountId: "acct-test",
        createdAt: "t",
        updatedAt: "t",
        resourceId: "r1",
        activityId: "missing-activity",
        startDate: "2026-06-05",
        endDate: "2026-06-05",
        hoursPerDay: 2,
        status: "confirmed",
      },
      {
        id: "dangling-attributed",
        accountId: "acct-test",
        createdAt: "t",
        updatedAt: "t",
        resourceId: "r1",
        activityId: "missing-activity",
        projectId: "p1",
        startDate: "2026-06-05",
        endDate: "2026-06-05",
        hoursPerDay: 2,
        status: "confirmed",
      },
    );
    const buildDangling = (filters = buildEmptyFilters(), showInternalProjects = true) =>
      buildSchedulerModel({
        data,
        geom,
        days,
        visibleWindow: { start, end },
        overSoonWindow: { start, end },
        filters,
        preferences: {
          disciplinesEnabled: true,
          placeholdersEnabled: true,
          externalEnabled: true,
          showInternalProjects,
        },
      });

    expect(barIds(buildDangling({ ...buildEmptyFilters(), clientId: internalId }))).not.toContain(
      "dangling-unattributed",
    );
    expect(barIds(buildDangling({ ...buildEmptyFilters(), clientId: "c1" }))).not.toContain("dangling-unattributed");
    expect(barIds(buildDangling({ ...buildEmptyFilters(), projectId: "p1" }))).not.toContain("dangling-unattributed");
    expect(barIds(buildDangling(buildEmptyFilters(), false))).toContain("dangling-unattributed");
    expect(barIds(buildDangling({ ...buildEmptyFilters(), clientId: "c1" }))).toContain("dangling-attributed");
    expect(barIds(buildDangling({ ...buildEmptyFilters(), projectId: "p1" }))).toContain("dangling-attributed");
  });
}
describe("built-in Internal client bucketing + filter", () => {
  const internalId = "c-internal";

  const buildInternal = (filters = buildEmptyFilters()) =>
    buildSchedulerModel({
      data: withInternal(),
      geom: geom,
      days: days,
      visibleWindow: { start: start, end: end },
      overSoonWindow: { start: start, end: end },
      filters: filters,
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    });

  const internalBarIds = (m: GroupModel[]) =>
    m
      .flatMap((g) => g.rows)
      .flatMap((r) => r.bars)
      .map((b) => b.allocation.id)
      .sort();

  registerMovedSchedulerTests14851(internalId, buildInternal, internalBarIds);

  registerMovedSchedulerTests14852(buildInternal, internalBarIds);

  registerMovedSchedulerTests14853(withInternal, internalId, internalBarIds);

  registerMovedSchedulerTests14854(withInternal, internalId);
});

// Per-account BAR-ONLY hide prefs for internal work (showInternalProjects / showInternalActivities).
// withInternal() gives r1 four allocations: a1 (Acme project), aIntProj (a project under the built-in
// Internal client), aIntNoProj (a project-less internal-KIND activity), plus a2 (tentative Acme); we
// add an unattributed repeatable allocation and one attributed to the Internal-owned project to pin
// the revised OWNER DECISION (2026-08-19): only unattributed all-projects work keeps the derived
// Internal label without becoming an Internal-project bar. The
// two prefs are the two LAST positional args after blocksMode + internalColourMode.
function registerMovedSchedulerTests16011(withInternal: () => AppData) {
  it("(d) defaults (absent fields → true) show every internal bar", () => {
    // No prefs passed at all: the params default to true, so nothing is hidden.
    const model = buildSchedulerModel({
      data: withInternal(),
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
    const ids = barIds(model);
    expect(ids).toContain("aIntProj"); // internal-client project bar
    expect(ids).toContain("aIntNoProj"); // internal-kind activity bar
  });
}

function registerMovedSchedulerTests16012(
  buildPrefs: (showInternalProjects: boolean, showInternalActivities: boolean) => GroupModel[],
) {
  it("(a) showInternalActivities=false hides internal-KIND bars only (all-projects + internal-client project stay)", () => {
    const ids = barIds(buildPrefs(true, false));
    expect(ids).not.toContain("aIntNoProj"); // kind 'internal' — hidden
    expect(ids).toContain("aRep"); // kind 'repeatable' — a distinct group, NEVER hidden by this toggle
    expect(ids).toContain("aRepAttributedInternal"); // effective client does not change the activity kind
    expect(ids).toContain("aIntProj"); // a 'project' activity — NOT an internal activity, still shown
    expect(ids).toContain("a1"); // ordinary Acme work untouched
  });
}

function registerMovedSchedulerTests16013(
  buildPrefs: (showInternalProjects: boolean, showInternalActivities: boolean) => GroupModel[],
) {
  it("(b) showInternalProjects=false hides internal-CLIENT project bars only (project-less activities stay)", () => {
    const ids = barIds(buildPrefs(false, true));
    expect(ids).not.toContain("aIntProj"); // project under the built-in Internal client — hidden
    expect(ids).not.toContain("aRepAttributedInternal"); // attributed repeatable work follows that project
    expect(ids).toContain("aIntNoProj"); // project-less internal-kind activity — still shown
    expect(ids).toContain("aRep"); // project-less repeatable activity — still shown
    expect(ids).toContain("a1"); // ordinary Acme project (non-Internal client) untouched
  });
}

function registerMovedSchedulerTests16014(
  buildPrefs: (showInternalProjects: boolean, showInternalActivities: boolean) => GroupModel[],
) {
  it("both false hides internal projects + internal activities, but unattributed all-projects and ordinary work survive", () => {
    const ids = barIds(buildPrefs(false, false));
    expect(ids).not.toContain("aIntProj");
    expect(ids).not.toContain("aIntNoProj");
    expect(ids).not.toContain("aRepAttributedInternal");
    expect(ids).toContain("aRep"); // all-projects is the third group — visible with BOTH toggles off
    expect(ids).toContain("a1");
  });
}

function registerMovedSchedulerTests16015(withInternalAndRepeatable: () => AppData) {
  it("does not retain full-opacity ghost rows when the active lens targets preference-hidden internal work", () => {
    const model = buildSchedulerModel({
      data: withInternalAndRepeatable(),
      geom: geom,
      days: days,
      visibleWindow: { start: start, end: end },
      overSoonWindow: { start: start, end: end },
      filters: { ...buildEmptyFilters(), activityKind: "internal", showUnmatched: false },
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
        showInternalProjects: true,
        showInternalActivities: false,
      },
    });

    expect(model.flatMap((group) => group.rows)).toHaveLength(0);
  });
}

function registerMovedSchedulerTests16016(
  buildPrefs: (showInternalProjects: boolean, showInternalActivities: boolean) => GroupModel[],
  r1Util: (model: GroupModel[]) => number,
) {
  it("(c) utilisation is IDENTICAL with the toggles on and off — hidden internal work still counts", () => {
    // THE product guarantee: hiding internal bars must NEVER change capacity/utilisation. r1 is booked
    // on internal work; its utilisation with everything shown must equal its utilisation with both
    // internal prefs OFF (bars gone, load unchanged).
    const shown = r1Util(buildPrefs(true, true));
    const hidden = r1Util(buildPrefs(false, false));
    expect(hidden).toBe(shown);
    // Sanity: r1 genuinely carries load (so the equality isn't a trivial 0 === 0), and the bar count
    // really did drop — proving the toggles took effect while utilisation held.
    expect(shown).toBeGreaterThan(0);
    expect(barIds(buildPrefs(true, true))).toContain("aRepAttributedInternal");
    expect(barIds(buildPrefs(false, true))).not.toContain("aRepAttributedInternal");
    expect(barIds(buildPrefs(false, false)).length).toBeLessThan(barIds(buildPrefs(true, true)).length);
  });
}
function buildInternalAndRepeatableData(): AppData {
  const d = withInternal();
  d.activities.push({
    id: "tRep",
    accountId: "acct-test",
    createdAt: "t",
    updatedAt: "t",
    name: "Design",
    kind: "repeatable",
  });
  d.allocations.push(
    {
      id: "aRep",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      resourceId: "r1",
      activityId: "tRep",
      startDate: "2026-06-05",
      endDate: "2026-06-05",
      hoursPerDay: 4,
      status: "confirmed",
    },
    {
      id: "aRepAttributedInternal",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      resourceId: "r1",
      activityId: "tRep",
      projectId: "pInt",
      startDate: "2026-06-05",
      endDate: "2026-06-05",
      hoursPerDay: 2,
      status: "confirmed",
    },
  );
  return d;
}

function registerInternalWorkPreferenceTests() {
  const buildPrefs = (showInternalProjects: boolean, showInternalActivities: boolean) =>
    buildSchedulerModel({
      data: buildInternalAndRepeatableData(),
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
        internalColourMode: "grey",
        showInternalProjects: showInternalProjects,
        showInternalActivities: showInternalActivities,
      },
    });

  const r1Util = (m: GroupModel[]) =>
    requireValue(
      m.flatMap((g) => g.rows).find((r) => r.resource.id === "r1"),
      "r1 scheduler row",
    ).utilization;

  // barIds (module scope, above) covers the same flatten+sort — reused here rather than redefined.

  registerMovedSchedulerTests16011(withInternal);

  registerMovedSchedulerTests16012(buildPrefs);

  registerMovedSchedulerTests16013(buildPrefs);

  registerMovedSchedulerTests16014(buildPrefs);

  registerMovedSchedulerTests16015(buildInternalAndRepeatableData);

  registerMovedSchedulerTests16016(buildPrefs, r1Util);
}

describe(
  "internal-work bar-only hide prefs (showInternalProjects / showInternalActivities)",
  registerInternalWorkPreferenceTests,
);

// Pan invariant — the load-bearing reason a Back/Forward pan keeps the visible-window utilisation
// correct WITHOUT any layout measurement. `panDays(+7)` shifts the origin date by a week while
// PRESERVING scrollLeft and dayWidth, so the visible-window start is still resolved by the SAME
// position index `indexAt(scrollLeft)`. Because the geometry for the new (shifted) days array has
// identical column widths (the weekday/weekend pattern repeats every 7 days), `indexAt(px)` returns
// the same index before and after — and the date at that index has advanced by exactly +7. A future
// change to panDays/anchoring that breaks this position-based correctness will fail here.
describe("pan invariant: a +7-day Back/Forward pan moves the visible-window start by exactly +7", () => {
  // A 6-week window so any in-window pixel resolves to a real interior column (not an edge clamp).
  const daysOld = eachDayISO("2026-06-01", "2026-07-12"); // Mon → 42 days
  const daysNew = daysOld.map((d) => addDaysISO(d, 7)); // same array shifted forward one week

  // Same dayWidth + weekend settings for both — exactly what panDays does (only originDate changes).
  for (const opts of [
    { minimiseWeekends: false, weekendWidth: 22 },
    { minimiseWeekends: true, weekendWidth: 22 }, // narrow weekends: widths still repeat weekly, so the index is stable
  ]) {
    const label = opts.minimiseWeekends ? "minimise ON" : "minimise OFF";
    const geomOld = buildColumnGeometry(daysOld, 48, opts);
    const geomNew = buildColumnGeometry(daysNew, 48, opts);

    it(`${label}: days_new[indexAt(px)] === addDaysISO(days_old[indexAt(px)], 7) on column boundaries`, () => {
      // Both geometries share identical widths (the weekly weekend pattern is invariant under a
      // 7-day shift), so the prefix-summed offsets — and thus indexAt — are identical.
      expect(geomNew.widths).toEqual(geomOld.widths);
      // Walk every column's left-edge pixel `px` (a real scrollLeft would land on these boundaries).
      for (let i = 0; i < daysOld.length; i++) {
        const px = geomOld.x(i);
        const idxOld = geomOld.indexAt(px);
        const idxNew = geomNew.indexAt(px);
        expect(idxNew).toBe(idxOld); // same position index before and after the pan
        // The resolved visible-start DATE advanced by exactly one week — no off-by-one, no drift.
        const oldDay = daysOld[idxOld];
        expect(oldDay).toBeDefined();
        if (!oldDay) throw new Error("Expected the old visible date.");
        expect(daysNew[idxNew]).toBe(addDaysISO(oldDay, 7));
      }
    });
  }
});

// P2.4: the scheduler renders the ACTIVE-ONLY projection (SchedulerGrid reads useActiveScopedData,
// which runs the SAME shared `activeOnly` exercised here). Prove that an archived resource and a
// soft-deleted resource produce NO lanes when the data is passed through `activeOnly`, while the
// active resources still do — pinning the production seam, not a re-implementation of the filter.
function registerMovedSchedulerTests17941(withNonActive: () => AppData, buildActive: (data: AppData) => GroupModel[]) {
  it("RAW data renders the archived + deleted lanes; the active-only projection does NOT", () => {
    const d = withNonActive();
    // Sanity: WITHOUT the projection, all four people + their bars render (the filter is what hides them).
    const raw = buildSchedulerModel({
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
    const rawResourceIds = raw.flatMap((g) => g.rows).map((r) => r.resource.id);
    expect(rawResourceIds).toEqual(expect.arrayContaining(["r1", "r2", "r-arch", "r-del"]));

    // WITH activeOnly: the archived + soft-deleted lanes are gone; the active ones remain.
    const model = buildActive(d);
    const resourceIds = model.flatMap((g) => g.rows).map((r) => r.resource.id);
    expect(resourceIds).toEqual(["r1", "r2"]); // ONLY the active people
    expect(resourceIds).not.toContain("r-arch");
    expect(resourceIds).not.toContain("r-del");
    // No bars for the dropped resources (their allocations have nowhere to land).
    const barIdsAll = barIds(model);
    expect(barIdsAll).not.toContain("a-arch");
    expect(barIdsAll).not.toContain("a-del");
    // Their now-empty discipline bands are dropped entirely (no empty Ops / QA headers).
    expect(model.map((g) => g.title)).not.toContain("Ops");
    expect(model.map((g) => g.title)).not.toContain("QA");
  });
}

function registerMovedSchedulerTests17942(buildActive: (data: AppData) => GroupModel[]) {
  it("hides scheduled work beneath an archived client", () => {
    // An ACTIVE project whose client is ARCHIVED, plus an ACTIVE activity on it, booked to r1.
    // The retained storage rows must not leak into the normal scheduler projection.
    const d = dataset();
    d.clients.push({
      id: "c-arch",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      name: "Gone Co",
      color: "#8",
      archivedAt: "2026-05-01T00:00:00.000Z",
    });
    d.projects.push({
      id: "p-orphan",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      name: "Orphan P",
      clientId: "c-arch",
      color: "#9",
    });
    d.activities.push({
      id: "t-orphan",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      name: "Orphan T",
      kind: "project",
      projectId: "p-orphan",
    });
    d.allocations.push({
      id: "a-orphan",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      resourceId: "r1",
      activityId: "t-orphan",
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      hoursPerDay: 8,
      status: "confirmed",
    });
    const model = buildActive(d);
    const barIdsAll = barIds(model);
    expect(barIdsAll).not.toContain("a-orphan");
  });
}
function buildNonActiveResourceData(): AppData {
  const d = dataset();
  d.disciplines.push(
    {
      id: "d-ops",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      name: "Ops",
      sortOrder: 2,
    },
    {
      id: "d-qa",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      name: "QA",
      sortOrder: 3,
    },
  );
  d.resources.push(
    // archived (archivedAt set) — must NOT render.
    makeResource({
      id: "r-arch",
      accountId: "acct-test",
      archivedAt: "2026-05-01T00:00:00.000Z",
      name: "Archived Ann",
      role: "Ops",
      disciplineId: "d-ops",
      color: "#6",
    }),
    // soft-deleted (deletedAt set) — must NOT render.
    makeResource({
      id: "r-del",
      accountId: "acct-test",
      archivedAt: "2026-05-01T00:00:00.000Z",
      deletedAt: "2026-05-20T00:00:00.000Z",
      name: "Deleted Del",
      role: "QA",
      disciplineId: "d-qa",
      color: "#7",
    }),
  );
  // A booking on each non-active resource — the lane and its bars must drop together.
  d.allocations.push(
    makeAllocation({ id: "a-arch", accountId: "acct-test", resourceId: "r-arch" }),
    makeAllocation({ id: "a-del", accountId: "acct-test", resourceId: "r-del" }),
  );
  return d;
}

function registerActiveOnlySchedulerTests() {
  const buildActive = (d: AppData) =>
    buildSchedulerModel({
      data: activeOnly(d),
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

  // dataset() has active people r1 (Design) + r2 (Development). Add an archived person and a
  // soft-deleted person, each in their OWN discipline so a dropped lane also empties its band.

  registerMovedSchedulerTests17941(buildNonActiveResourceData, buildActive);

  registerMovedSchedulerTests17942(buildActive);
}

describe(
  "buildSchedulerModel(activeOnly(data), …) — non-active resources vanish (P2.4)",
  registerActiveOnlySchedulerTests,
);
