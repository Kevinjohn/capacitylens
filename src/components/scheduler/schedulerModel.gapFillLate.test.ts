import { describe, expect, it } from "vitest";
import type { Allocation, AppData, ISODate, Resource } from "@capacitylens/shared/types/entities";
import { weekdayOf } from "@capacitylens/shared/lib/dateMath";
import { buildEmptyFilters } from "../../store/useStore";
import { makeAllocation, makeResource, requireValue } from "../../test/fixtures";
import { isCreationStartBlocked } from "./creationAvailability";
import { buildSchedulerModel, type GroupModel } from "./schedulerModel";
import { buildColumnGeometry } from "./columnGeometry";
import {
  DEFAULT_ACCOUNT_WORKING_DAYS,
  capacityForWindowOf,
  dataset,
  days,
  end,
  geom,
  start,
  utilizationOf,
  withExternal,
} from "./schedulerModel.testSupport";

interface AllocationTestInput {
  id: string;
  resourceId: string;
  startDate: string;
  endDate: string;
  hoursPerDay: number;
}

function registerMovedSchedulerTests201021() {
  it("positions overlapping bars on the SAME resource at DIFFERENT lane tops (laneById is a real Map, not empty)", () => {
    const d = dataset();
    // a1 already books r1 on 2026-06-01..02; a second, overlapping allocation forces a 2nd lane.
    d.allocations.push({
      id: "a-overlap",
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
    const r1bars = requireValue(
      model.flatMap((g) => g.rows).find((r) => r.resource.id === "r1"),
      "r1 scheduler row",
    ).bars;
    const tops = new Set(
      r1bars.filter((b) => b.allocation.id === "a1" || b.allocation.id === "a-overlap").map((b) => b.top),
    );
    expect(tops.size).toBe(2);
  });
}

function registerMovedSchedulerTests201022() {
  it("overSoon truly SKIPS external resources — even one with real over-capacity hours", () => {
    const d = withExternal();
    // ext1's workingHoursPerDay is 8; this 20h booking on a working Monday WOULD read as over if
    // the external guard were bypassed.
    d.allocations.push({
      id: "aext2",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      resourceId: "ext1",
      activityId: "t1",
      startDate: "2026-06-01",
      endDate: "2026-06-01",
      hoursPerDay: 20,
      status: "confirmed",
    });
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
    const externalGroup = requireValue(model.at(-1), "external group");
    expect(requireValue(externalGroup.rows[0], "external group row").overSoon).toBe(false);
  });
}

function registerMovedSchedulerTests201023() {
  it("overSoon follows strict allocated > available on an opted-in weekend", () => {
    const d = dataset();
    // r1 works Mon–Fri; 2026-06-06 is a Saturday (available = 0 for r1 regardless of ignoreWeekends
    // — that flag only affects whether the allocation counts hours there, not the resource's
    // availability). ignoreWeekends: true makes the allocation actually WORK that zero-capacity day.
    d.allocations.push({
      id: "a-sat",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      resourceId: "r1",
      activityId: "t1",
      startDate: "2026-06-06",
      endDate: "2026-06-06",
      hoursPerDay: 8,
      status: "confirmed",
      ignoreWeekends: true,
    });
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
    expect(r1.overSoon).toBe(true);
  });
}

function registerMovedSchedulerTests201024() {
  it("computes one resource-day once when timeline, utilisation and overSoon windows overlap", () => {
    const d = dataset();
    let hoursReads = 0;
    Object.defineProperty(requireValue(d.allocations[0], "first allocation"), "hoursPerDay", {
      configurable: true,
      enumerable: true,
      get: () => {
        hoursReads += 1;
        return 8;
      },
    });
    const oneDay = ["2026-06-01"];
    const oneDayGeom = buildColumnGeometry(oneDay, 48, {
      minimiseWeekends: false,
      weekendWidth: 22,
    });

    buildSchedulerModel({
      data: d,
      geom: oneDayGeom,
      days: oneDay,
      visibleWindow: { start: requireValue(oneDay[0], "timeline day"), end: requireValue(oneDay[0], "timeline day") },
      overSoonWindow: { start: requireValue(oneDay[0], "timeline day"), end: requireValue(oneDay[0], "timeline day") },
      filters: buildEmptyFilters(),
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    });

    expect(hoursReads).toBe(1);
  });
}

function registerMovedSchedulerTests201025(withThirdResource: () => AppData) {
  it("utilization/overSoon are IDENTICAL to calling the capacity functions directly, for every resource in a multi-resource model", () => {
    // A distinct 3rd resource + allocation shape so three resources each have different load.
    const d = withThirdResource();
    const visStart = "2026-06-02";
    const visEnd = "2026-06-05";
    const overStart = "2026-06-01";
    const overEnd = "2026-06-03";
    const model = buildSchedulerModel({
      data: d,
      geom: geom,
      days: days,
      visibleWindow: { start: visStart, end: visEnd },
      overSoonWindow: { start: overStart, end: overEnd },
      filters: buildEmptyFilters(),
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    });
    const rows = model.flatMap((g) => g.rows);
    for (const resource of d.resources) {
      const allocs = d.allocations.filter((a) => a.resourceId === resource.id);
      const expectedUtil = utilizationOf({
        resource,
        allocations: allocs,
        timeOff: [],
        windowStart: visStart,
        windowEnd: visEnd,
      });
      const expectedOver = capacityForWindowOf({
        resource,
        allocations: allocs,
        timeOff: [],
        windowStart: overStart,
        windowEnd: overEnd,
      }).some((c) => c.allocated > c.available);
      const row = requireValue(
        rows.find((r) => r.resource.id === resource.id),
        `${resource.id} scheduler row`,
      );
      expect(row.utilization).toBeCloseTo(expectedUtil);
      expect(row.overSoon).toBe(expectedOver);
    }
  });
}

function registerMovedSchedulerTests201026({
  alloc,
  buildBucketComparisonData,
  buildBucketComparisonModel,
  assertBucketComparisonResource,
  assertBucketComparisonSummary,
}: {
  alloc: (input: AllocationTestInput) => Allocation;
  buildBucketComparisonData: (alloc: (input: AllocationTestInput) => Allocation) => AppData;
  buildBucketComparisonModel: (data: AppData, visStart: ISODate, visEnd: ISODate) => GroupModel[];
  assertBucketComparisonResource: (input: {
    resourceId: string;
    d: AppData;
    rows: ReturnType<typeof buildSchedulerModel>[number]["rows"];
    visStart: ISODate;
    visEnd: ISODate;
  }) => void;
  assertBucketComparisonSummary: (rows: ReturnType<typeof buildSchedulerModel>[number]["rows"]) => void;
}) {
  it("dayStates and utilization are EXACTLY those of capacity.ts scanning the unbucketed lists", () => {
    const d = buildBucketComparisonData(alloc);
    const visStart = "2026-06-02";
    const visEnd = "2026-06-06";
    const model = buildBucketComparisonModel(d, visStart, visEnd);
    const rows = model.flatMap((g) => g.rows);
    for (const resourceId of ["r1", "r2"]) {
      assertBucketComparisonResource({ resourceId, d, rows, visStart, visEnd });
    }
    assertBucketComparisonSummary(rows);
  });
}
function buildBucketComparisonData(alloc: (input: AllocationTestInput) => Allocation) {
  const d = dataset();
  d.allocations = [
    // Spans the whole timeline (starts before it, ends after it) — bucketing must clip, not drop.
    alloc({
      id: "b1",
      resourceId: "r1",
      startDate: "2026-05-20",
      endDate: "2026-06-20",
      hoursPerDay: 2.1,
    }),
    // Overlaps b1 on working days; three fractional sums land on the same days.
    alloc({
      id: "b2",
      resourceId: "r1",
      startDate: "2026-06-02",
      endDate: "2026-06-04",
      hoursPerDay: 3.3,
    }),
    alloc({
      id: "b3",
      resourceId: "r1",
      startDate: "2026-06-03",
      endDate: "2026-06-03",
      hoursPerDay: 2.7,
    }),
    // Weekend-aware (default): merely spans Sat/Sun 06-06/06-07, so it does no work there.
    alloc({
      id: "b4",
      resourceId: "r1",
      startDate: "2026-06-04",
      endDate: "2026-06-07",
      hoursPerDay: 8,
    }),
    // Opts into weekends: 0 capacity there, so it must still read as over on Sat/Sun.
    {
      ...alloc({
        id: "b5",
        resourceId: "r2",
        startDate: "2026-06-05",
        endDate: "2026-06-07",
        hoursPerDay: 4,
      }),
      ignoreWeekends: true,
    },
    alloc({
      id: "b6",
      resourceId: "r2",
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      hoursPerDay: 8,
    }),
  ];
  addBucketComparisonClosure(d);
  addBucketComparisonTimeOff(d);
  return d;
}

function addBucketComparisonClosure(d: AppData) {
  d.closures = [
    {
      id: "company-to",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      name: "Company shutdown",
      startDate: "2026-06-03",
      endDate: "2026-06-03",
    },
  ];
}

function addBucketComparisonTimeOff(d: AppData) {
  d.timeOff = [
    {
      id: "to1",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      resourceId: "r1",
      startDate: "2026-06-03",
      endDate: "2026-06-04",
      type: "holiday",
    },
    // Starts before the timeline and ends inside it — the other clipping direction.
    {
      id: "to2",
      accountId: "acct-test",
      createdAt: "t",
      updatedAt: "t",
      resourceId: "r2",
      startDate: "2026-05-28",
      endDate: "2026-06-02",
      type: "sick",
    },
  ];
}

function buildBucketComparisonModel(d: AppData, visStart: ISODate, visEnd: ISODate) {
  const model = buildSchedulerModel({
    data: d,
    geom: geom,
    days: days,
    visibleWindow: { start: visStart, end: visEnd },
    overSoonWindow: { start: start, end: end },
    filters: buildEmptyFilters(),
    preferences: {
      disciplinesEnabled: true,
      placeholdersEnabled: true,
      externalEnabled: true,
    },
  });
  return model;
}

function assertBucketComparisonResource({
  resourceId,
  d,
  rows,
  visStart,
  visEnd,
}: {
  resourceId: string;
  d: AppData;
  rows: ReturnType<typeof buildSchedulerModel>[number]["rows"];
  visStart: ISODate;
  visEnd: ISODate;
}) {
  const resource = requireValue(
    d.resources.find((r) => r.id === resourceId),
    `${resourceId} resource`,
  );
  const allocs = d.allocations.filter((a) => a.resourceId === resourceId);
  const off = d.timeOff.filter((t) => t.resourceId === resourceId);
  const row = requireValue(
    rows.find((r) => r.resource.id === resourceId),
    `${resourceId} scheduler row`,
  );
  const firstDay = requireValue(days[0], "first timeline day");
  const lastDay = requireValue(days[days.length - 1], "last timeline day");
  const naiveTimeline = capacityForWindowOf({
    resource,
    allocations: allocs,
    timeOff: off,
    windowStart: firstDay,
    windowEnd: lastDay,
    accountWorkingDays: DEFAULT_ACCOUNT_WORKING_DAYS,
    closures: d.closures,
  });
  assertBucketComparisonDayStates({ row, naiveTimeline, resource, off, closures: d.closures });
  expect(row.utilization).toBe(
    utilizationOf({
      resource,
      allocations: allocs,
      timeOff: off,
      windowStart: visStart,
      windowEnd: visEnd,
      accountWorkingDays: DEFAULT_ACCOUNT_WORKING_DAYS,
      closures: d.closures,
    }),
  );
  expect(row.overSoon).toBe(
    capacityForWindowOf({
      resource,
      allocations: allocs,
      timeOff: off,
      windowStart: start,
      windowEnd: end,
      accountWorkingDays: DEFAULT_ACCOUNT_WORKING_DAYS,
      closures: d.closures,
    }).some((c) => c.over),
  );
}

function assertBucketComparisonDayStates({
  row,
  naiveTimeline,
  resource,
  off,
  closures,
}: {
  row: ReturnType<typeof buildSchedulerModel>[number]["rows"][number];
  naiveTimeline: ReturnType<typeof capacityForWindowOf>;
  resource: Resource;
  off: AppData["timeOff"];
  closures: AppData["closures"];
}) {
  expect(row.dayStates).toEqual(
    naiveTimeline.map((c, index) => {
      const date = requireValue(days[index], `timeline day ${index}`);
      const creationBlocked = isCreationStartBlocked({
        resource,
        date,
        timeOff: off,
        accountWorkingDays: [1, 2, 3, 4, 5],
        closures: closures,
      });
      const hasTimeOff = [...off, ...closures].some((entry) => entry.startDate <= date && entry.endDate >= date);
      return {
        over: c.over,
        timeOffConflict: c.over && hasTimeOff,
        unavailable: c.available === 0 || creationBlocked,
        partialCapacity: c.available > 0 && !creationBlocked && resource.halfDays.includes(weekdayOf(date)),
        creationBlocked,
        hasTimeOff,
      };
    }),
  );
}

function assertBucketComparisonSummary(rows: ReturnType<typeof buildSchedulerModel>[number]["rows"]) {
  const r1 = requireValue(
    rows.find((r) => r.resource.id === "r1"),
    "r1 scheduler row",
  );
  expect(r1.dayStates.some((s) => s.over)).toBe(true);
  expect(r1.dayStates.some((s) => s.unavailable)).toBe(true);
  expect(r1.conflictDayCount).toBe(r1.dayStates.filter((s) => s.over || s.timeOffConflict).length);
  expect(r1.partialCapacityDayCount).toBe(r1.dayStates.filter((s) => s.partialCapacity).length);
}

function alloc({ id, resourceId, startDate, endDate, hoursPerDay }: AllocationTestInput): Allocation {
  return {
    id,
    accountId: "acct-test",
    createdAt: "t",
    updatedAt: "t",
    resourceId,
    activityId: "t1",
    startDate,
    endDate,
    hoursPerDay,
    status: "confirmed",
  };
}

function withThirdResource(): AppData {
  const data = dataset();
  data.resources.push(
    makeResource({
      id: "r3",
      accountId: "acct-test",
      name: "QA Quinn",
      role: "QA",
      disciplineId: "d-dev",
      workingHoursPerDay: 6,
      color: "#6",
    }),
  );
  data.allocations.push(
    makeAllocation({
      id: "a5",
      accountId: "acct-test",
      resourceId: "r3",
      activityId: "t2",
      startDate: "2026-06-01",
      endDate: "2026-06-05",
      hoursPerDay: 3,
    }),
  );
  return data;
}

function registerMutationTestingGapFillLateTests() {
  registerMovedSchedulerTests201021();
  registerMovedSchedulerTests201022();
  registerMovedSchedulerTests201023();
  registerMovedSchedulerTests201024();
  registerMovedSchedulerTests201025(withThirdResource);
  registerMovedSchedulerTests201026({
    alloc,
    buildBucketComparisonData,
    buildBucketComparisonModel,
    assertBucketComparisonResource,
    assertBucketComparisonSummary,
  });
}

describe("buildSchedulerModel — mutation-testing gap-fill", registerMutationTestingGapFillLateTests);
