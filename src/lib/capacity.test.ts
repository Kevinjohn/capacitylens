import { describe, it, expect, vi } from "vitest";
import {
  type DayCapacity,
  applyCapacityMode,
  resolveAllocatedHoursOnDay as allocatedHoursOnDayWithWeek,
  resolveAvailableHoursOnDay as availableHoursOnDayWithWeek,
  buildCapacityAdvisory as capacityAdvisoryWithWeek,
  buildCapacityWindow as capacityForWindowWithWeek,
  buildDayCapacity as dayCapacityWithWeek,
  formatCapacityAdvisory,
  isHalfDay,
  isOnClosure,
  isOnTimeOff,
  isWorkingDay as isWorkingDayWithWeek,
  resolveScheduledHoursOnDay as scheduledHoursOnDayWithWeek,
  resolveUtilization as utilizationWithWeek,
  resolveUtilizationFromCapacity,
  type CapacityAllocationInput,
} from "./capacity";
import { addDaysISO, eachDayISO } from "@capacitylens/shared/lib/dateMath";
import { effectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import { MAX_SPAN_DAYS } from "@capacitylens/shared/lib/schedulingDays";
import type { Allocation, Closure, ISODate, Resource, TimeOff, Weekday } from "@capacitylens/shared/types/entities";

function valueAt<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`Expected value at index ${index}`);
  return value;
}

interface AvailableHoursOnDayTestInput {
  resource: Resource;
  date: ISODate;
  timeOff: TimeOff[];
  accountWorkingDays?: Weekday[] | undefined;
}

interface AllocatedHoursOnDayTestInput {
  resource: Resource;
  date: ISODate;
  allocations: Allocation[];
  accountWorkingDays?: Weekday[] | undefined;
}

interface DayCapacityTestInput {
  resource: Resource;
  date: ISODate;
  allocations: Allocation[];
  timeOff: TimeOff[];
  accountWorkingDays?: Weekday[] | undefined;
}

interface CapacityForWindowTestInput {
  resource: Resource;
  allocations: Allocation[];
  timeOff: TimeOff[];
  start: ISODate;
  end: ISODate;
  accountWorkingDays?: Weekday[] | undefined;
}

interface UtilizationTestInput {
  resource: Resource;
  allocations: Allocation[];
  timeOff: TimeOff[];
  start: ISODate;
  end: ISODate;
  accountWorkingDays?: Weekday[] | undefined;
  closures?: Closure[] | undefined;
}

interface CapacityAdvisoryTestInput {
  resource: Resource;
  proposal: CapacityAllocationInput;
  otherAllocations: readonly CapacityAllocationInput[];
  timeOff: TimeOff[];
  accountWorkingDays?: Weekday[] | undefined;
  closures?: Closure[] | undefined;
}

interface CapacityCaseInput {
  name: string;
  date: ISODate;
  allocations: readonly Allocation[];
  timeOff: readonly TimeOff[];
  expected: Pick<DayCapacity, "allocated" | "available" | "over">;
}

interface ProposalTestInput {
  startDate: ISODate;
  endDate: ISODate;
  hoursPerDay: number;
  ignoreWeekends: boolean;
}

const DEFAULT_ACCOUNT_WORKING_DAYS: Weekday[] = [1, 2, 3, 4, 5];
const weekFor = (resource: Resource, accountWorkingDays = DEFAULT_ACCOUNT_WORKING_DAYS) =>
  effectiveWorkingWeek(resource, accountWorkingDays);
const scheduledHoursOnDay = (resource: Resource, date: ISODate, accountWorkingDays?: Weekday[]) =>
  scheduledHoursOnDayWithWeek(resource, date, weekFor(resource, accountWorkingDays));
const availableHoursOnDay = ({ resource, date, timeOff, accountWorkingDays }: AvailableHoursOnDayTestInput) =>
  availableHoursOnDayWithWeek({
    resource: resource,
    date: date,
    timeOff: timeOff,
    effectiveWeek: weekFor(resource, accountWorkingDays),
    closures: [],
  });
const allocatedHoursOnDay = ({ resource, date, allocations, accountWorkingDays }: AllocatedHoursOnDayTestInput) =>
  allocatedHoursOnDayWithWeek({
    resource: resource,
    date: date,
    allocations: allocations,
    effectiveWeek: weekFor(resource, accountWorkingDays),
  });
const dayCapacity = ({ resource, date, allocations, timeOff, accountWorkingDays }: DayCapacityTestInput) =>
  dayCapacityWithWeek({
    resource: resource,
    date: date,
    allocations: allocations,
    timeOff: timeOff,
    effectiveWeek: weekFor(resource, accountWorkingDays),
    closures: [],
  });
const capacityForWindow = ({
  resource,
  allocations,
  timeOff,
  start,
  end,
  accountWorkingDays,
}: CapacityForWindowTestInput) =>
  capacityForWindowWithWeek({
    resource: resource,
    allocations: allocations,
    timeOff: timeOff,
    start: start,
    end: end,
    effectiveWeek: weekFor(resource, accountWorkingDays),
    closures: [],
  });
const utilization = ({
  resource,
  allocations,
  timeOff,
  start,
  end,
  accountWorkingDays,
  closures = [],
}: UtilizationTestInput) =>
  utilizationWithWeek({
    resource: resource,
    allocations: allocations,
    timeOff: timeOff,
    start: start,
    end: end,
    effectiveWeek: weekFor(resource, accountWorkingDays),
    closures: closures,
  });
const capacityAdvisory = ({
  resource,
  proposal,
  otherAllocations,
  timeOff,
  accountWorkingDays,
  closures = [],
}: CapacityAdvisoryTestInput) =>
  capacityAdvisoryWithWeek({
    resource: resource,
    proposal: proposal,
    otherAllocations: otherAllocations,
    timeOff: timeOff,
    effectiveWeek: weekFor(resource, accountWorkingDays),
    closures: closures,
  });
const isWorkingDay = (resource: Resource, date: ISODate, accountWorkingDays?: Weekday[]) =>
  isWorkingDayWithWeek(weekFor(resource, accountWorkingDays), date);

const makeResource = (over: Partial<Resource> = {}): Resource => ({
  id: "r1",
  accountId: "acct-test",
  createdAt: "t",
  updatedAt: "t",
  kind: "person",
  role: "Developer",
  employmentType: "permanent",
  engagement: "studio" as const,
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5], // Mon–Fri
  color: "#000",
  ...over,
  halfDays: over.halfDays ?? [],
});

const makeAlloc = (over: Partial<Allocation> = {}): Allocation => ({
  id: "a1",
  accountId: "acct-test",
  createdAt: "t",
  updatedAt: "t",
  resourceId: "r1",
  activityId: "activity1",
  startDate: "2026-06-01",
  endDate: "2026-06-05",
  hoursPerDay: 4,
  status: "confirmed",
  ...over,
});

const makeTimeOff = (over: Partial<TimeOff> = {}): TimeOff => ({
  id: "to1",
  accountId: "acct-test",
  createdAt: "t",
  updatedAt: "t",
  resourceId: "r1",
  startDate: "2026-06-03",
  endDate: "2026-06-03",
  type: "holiday",
  ...over,
});

const makeClosure = (over: Partial<Closure> = {}): Closure => ({
  id: "closure1",
  accountId: "acct-test",
  createdAt: "t",
  updatedAt: "t",
  name: "Company shutdown",
  startDate: "2026-06-03",
  endDate: "2026-06-03",
  ...over,
});

describe("#257 characterization: effective-week capacity", () => {
  // Flipped in Phase 3: capacity and load now use the company/personal effective week.
  it("removes Friday capacity, load and utilisation when the company calendar excludes Friday", () => {
    const accountWorkingDays: Weekday[] = [1, 2, 3, 4];
    const resource = makeResource({ workingDays: [1, 2, 3, 4, 5] });
    const allocation = makeAlloc({
      startDate: "2026-06-01",
      endDate: "2026-06-05",
      hoursPerDay: 8,
    });

    expect(scheduledHoursOnDay(resource, "2026-06-05", accountWorkingDays)).toBe(0);
    expect(
      availableHoursOnDay({
        resource: resource,
        date: "2026-06-05",
        timeOff: [],
        accountWorkingDays: accountWorkingDays,
      }),
    ).toBe(0);
    expect(
      allocatedHoursOnDay({
        resource: resource,
        date: "2026-06-05",
        allocations: [allocation],
        accountWorkingDays: accountWorkingDays,
      }),
    ).toBe(0);
    expect(
      utilization({
        resource: resource,
        allocations: [allocation],
        timeOff: [],
        start: "2026-06-05",
        end: "2026-06-05",
        accountWorkingDays: accountWorkingDays,
      }),
    ).toBe(0);
  });

  // Flipped in Phase 3: intersecting with a partial company week makes a seven-day
  // resource weekend-aware, so weekend hours stop counting.
  it("does not load Saturday and Sunday for a normal allocation on a seven-day resource", () => {
    const resource = makeResource({ workingDays: [0, 1, 2, 3, 4, 5, 6] });
    const allocation = makeAlloc({
      startDate: "2026-06-01",
      endDate: "2026-06-07",
      hoursPerDay: 8,
    });

    expect(allocatedHoursOnDay({ resource: resource, date: "2026-06-06", allocations: [allocation] })).toBe(0);
    expect(allocatedHoursOnDay({ resource: resource, date: "2026-06-07", allocations: [allocation] })).toBe(0);
  });
});

describe("effective working-week semantics table", () => {
  const resource = makeResource();
  const monday = "2026-06-01" as ISODate;
  const friday = "2026-06-05" as ISODate;
  const companyMondayOnly: Weekday[] = [1];
  const mondayOff = [makeTimeOff({ startDate: monday, endDate: monday })];
  const fridayOff = [makeTimeOff({ startDate: friday, endDate: friday })];
  const normalMonday = [makeAlloc({ startDate: monday, endDate: monday, hoursPerDay: 8 })];
  const normalFriday = [makeAlloc({ startDate: friday, endDate: friday, hoursPerDay: 8 })];
  const ignoredFriday = [makeAlloc({ startDate: friday, endDate: friday, hoursPerDay: 8, ignoreWeekends: true })];
  const blockMonday = applyCapacityMode({ allocations: normalMonday, blocksMode: true });
  const blockFriday = applyCapacityMode({ allocations: normalFriday, blocksMode: true });

  function registerSemanticsTableTests() {
    it.each([
      {
        name: "normal allocation on an effective day",
        date: monday,
        allocations: normalMonday,
        timeOff: [],
        expected: { allocated: 8, available: 8, over: false },
      },
      {
        name: "normal allocation over time off on an effective day",
        date: monday,
        allocations: normalMonday,
        timeOff: mondayOff,
        expected: { allocated: 8, available: 0, over: true },
      },
      {
        name: "normal allocation on a company day off",
        date: friday,
        allocations: normalFriday,
        timeOff: [],
        expected: { allocated: 0, available: 0, over: false },
      },
      {
        name: "normal allocation on a company day off plus time off",
        date: friday,
        allocations: normalFriday,
        timeOff: fridayOff,
        expected: { allocated: 0, available: 0, over: false },
      },
      {
        name: "ignored allocation on a company day off",
        date: friday,
        allocations: ignoredFriday,
        timeOff: [],
        expected: { allocated: 8, available: 0, over: true },
      },
      {
        name: "ignored allocation on a company day off plus time off",
        date: friday,
        allocations: ignoredFriday,
        timeOff: fridayOff,
        expected: { allocated: 8, available: 0, over: true },
      },
      {
        name: "zero-load block on a company day off",
        date: friday,
        allocations: blockFriday,
        timeOff: [],
        expected: { allocated: 0, available: 0, over: false },
      },
      {
        name: "zero-load block over time off",
        date: monday,
        allocations: blockMonday,
        timeOff: mondayOff,
        expected: { allocated: 0, available: 0, over: false },
      },
    ] as const)("implements $name", ({ date, allocations, timeOff, expected }: CapacityCaseInput) => {
      expect(
        dayCapacity({
          resource: resource,
          date: date,
          allocations: [...allocations],
          timeOff: [...timeOff],
          accountWorkingDays: companyMondayOnly,
        }),
      ).toMatchObject(expected);
      expect(isOnTimeOff(resource.id, date, [...timeOff])).toBe(timeOff.length > 0);
    });
  }
  registerSemanticsTableTests();

  function registerNoneWeekTest() {
    it("keeps a none-week resource at zero capacity and normal load while ignored load remains calendar-day work", () => {
      const noneCompanyWeek: Weekday[] = [];
      const normal = [makeAlloc({ startDate: monday, endDate: monday, hoursPerDay: 8 })];
      const ignored = [makeAlloc({ startDate: monday, endDate: monday, hoursPerDay: 8, ignoreWeekends: true })];

      expect(scheduledHoursOnDay(resource, monday, noneCompanyWeek)).toBe(0);
      expect(
        availableHoursOnDay({ resource: resource, date: monday, timeOff: [], accountWorkingDays: noneCompanyWeek }),
      ).toBe(0);
      expect(
        allocatedHoursOnDay({
          resource: resource,
          date: monday,
          allocations: normal,
          accountWorkingDays: noneCompanyWeek,
        }),
      ).toBe(0);
      expect(
        dayCapacity({
          resource: resource,
          date: monday,
          allocations: normal,
          timeOff: [],
          accountWorkingDays: noneCompanyWeek,
        }).over,
      ).toBe(false);
      expect(
        allocatedHoursOnDay({
          resource: resource,
          date: monday,
          allocations: ignored,
          accountWorkingDays: noneCompanyWeek,
        }),
      ).toBe(8);
      expect(
        dayCapacity({
          resource: resource,
          date: monday,
          allocations: ignored,
          timeOff: [],
          accountWorkingDays: noneCompanyWeek,
        }),
      ).toMatchObject({
        allocated: 8,
        available: 0,
        over: true,
      });
    });
  }
  registerNoneWeekTest();
});

describe("capacityAllocationsForMode", () => {
  it("preserves hourly allocations and projects blocks to zero load without mutating input", () => {
    const allocations = [makeAlloc({ hoursPerDay: 7 })];
    expect(applyCapacityMode({ allocations: allocations, blocksMode: false })).toBe(allocations);
    const blocks = applyCapacityMode({ allocations: allocations, blocksMode: true });
    expect(blocks).toEqual([{ ...allocations[0], hoursPerDay: 0 }]);
    expect(allocations[0]?.hoursPerDay).toBe(7);
  });
});

describe("availability", () => {
  const r = makeResource();

  it("ignores stored placeholder half days while retaining personal half days", () => {
    const person = makeResource({ halfDays: [2] });
    const placeholder = makeResource({ kind: "placeholder", halfDays: [2] });

    expect(isHalfDay(person, 2)).toBe(true);
    expect(isHalfDay(placeholder, 2)).toBe(false);
    expect(scheduledHoursOnDay(placeholder, "2026-06-02")).toBe(8);
  });

  it("knows working vs non-working weekdays", () => {
    expect(isWorkingDay(r, "2026-06-01")).toBe(true); // Monday
    expect(isWorkingDay(r, "2026-06-06")).toBe(false); // Saturday
    expect(isWorkingDay(r, "2026-06-07")).toBe(false); // Sunday
  });

  it("detects time off ranges", () => {
    const timeOff = [makeTimeOff({ startDate: "2026-06-03", endDate: "2026-06-04" })];
    expect(isOnTimeOff("r1", "2026-06-03", timeOff)).toBe(true);
    expect(isOnTimeOff("r1", "2026-06-04", timeOff)).toBe(true);
    expect(isOnTimeOff("r1", "2026-06-05", timeOff)).toBe(false);
    expect(isOnTimeOff("other", "2026-06-03", timeOff)).toBe(false);
  });

  it("covers people and placeholders but not external resources", () => {
    const closure = makeClosure();
    const personal = makeTimeOff({ id: "personal", resourceId: "r1", startDate: "2026-06-04", endDate: "2026-06-04" });

    expect(isOnClosure(makeResource(), "2026-06-03", [closure])).toBe(true);
    expect(isOnClosure(makeResource({ kind: "placeholder" }), "2026-06-03", [closure])).toBe(true);
    expect(isOnClosure(makeResource({ kind: "external" }), "2026-06-03", [closure])).toBe(false);
    expect(isOnTimeOff("r1", "2026-06-04", [personal])).toBe(true);
  });

  it("treats a closure as a literal inclusive span across a weekend", () => {
    const closure = makeClosure({ startDate: "2026-06-05", endDate: "2026-06-08" });

    expect(isOnClosure(r, "2026-06-05", [closure])).toBe(true);
    expect(isOnClosure(r, "2026-06-06", [closure])).toBe(true);
    expect(isOnClosure(r, "2026-06-07", [closure])).toBe(true);
    expect(isOnClosure(r, "2026-06-08", [closure])).toBe(true);
  });

  it("uses fixed eight-hour full days, four-hour half days, and zero for non-working/time-off days", () => {
    expect(availableHoursOnDay({ resource: r, date: "2026-06-01", timeOff: [] })).toBe(8); // Monday
    expect(
      availableHoursOnDay({
        resource: makeResource({ workingHoursPerDay: 6, halfDays: [2] }),
        date: "2026-06-02",
        timeOff: [],
      }),
    ).toBe(4);
    expect(
      availableHoursOnDay({ resource: makeResource({ workingHoursPerDay: 6 }), date: "2026-06-01", timeOff: [] }),
    ).toBe(8);
    expect(availableHoursOnDay({ resource: r, date: "2026-06-06", timeOff: [] })).toBe(0); // Saturday
    expect(
      availableHoursOnDay({ resource: makeResource({ halfDays: [3] }), date: "2026-06-03", timeOff: [makeTimeOff()] }),
    ).toBe(0);
  });
});

describe("devAssertFinite (DEV-only console.warn on a non-finite allocation)", () => {
  const r = makeResource();

  it("ignores a legacy non-finite workingHoursPerDay because full-day capacity is fixed", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    availableHoursOnDay({ resource: makeResource({ workingHoursPerDay: NaN }), date: "2026-06-01", timeOff: [] }); // Monday
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('warns with the "allocated hours sum" label when the summed allocation hours are not finite', () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const allocs = [
      makeAlloc({
        startDate: "2026-06-01",
        endDate: "2026-06-01",
        hoursPerDay: NaN,
      }),
    ];
    allocatedHoursOnDay({ resource: r, date: "2026-06-01", allocations: allocs });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("allocated hours sum");
    warn.mockRestore();
  });
});

describe("allocatedHoursOnDay", () => {
  const r = makeResource(); // Mon–Fri

  function registerOverlappingAllocationTests() {
    it("sums overlapping allocations for the resource only", () => {
      const allocs = [
        makeAlloc({
          id: "a1",
          startDate: "2026-06-01",
          endDate: "2026-06-05",
          hoursPerDay: 4,
        }),
        makeAlloc({
          id: "a2",
          startDate: "2026-06-03",
          endDate: "2026-06-03",
          hoursPerDay: 3,
        }),
        makeAlloc({
          id: "a3",
          resourceId: "other",
          startDate: "2026-06-03",
          endDate: "2026-06-03",
          hoursPerDay: 9,
        }),
      ];
      expect(allocatedHoursOnDay({ resource: r, date: "2026-06-02", allocations: allocs })).toBe(4);
      expect(allocatedHoursOnDay({ resource: r, date: "2026-06-03", allocations: allocs })).toBe(7); // 4 + 3, ignoring other resource
      expect(allocatedHoursOnDay({ resource: r, date: "2026-06-10", allocations: allocs })).toBe(0);
    });
  }
  registerOverlappingAllocationTests();

  function registerWeekendRuleTests() {
    it("a weekend-aware allocation does no work on a weekend it merely spans", () => {
      // Fri 06-05 .. Mon 06-08 spans Sat 06-06 / Sun 06-07. The default (weekend-aware)
      // allocation works only the resource's weekdays, so the weekend contributes 0.
      const allocs = [
        makeAlloc({
          startDate: "2026-06-05",
          endDate: "2026-06-08",
          hoursPerDay: 8,
        }),
      ];
      expect(allocatedHoursOnDay({ resource: r, date: "2026-06-05", allocations: allocs })).toBe(8); // Fri (working)
      expect(allocatedHoursOnDay({ resource: r, date: "2026-06-06", allocations: allocs })).toBe(0); // Sat (spanned, no work)
      expect(allocatedHoursOnDay({ resource: r, date: "2026-06-07", allocations: allocs })).toBe(0); // Sun (spanned, no work)
      expect(allocatedHoursOnDay({ resource: r, date: "2026-06-08", allocations: allocs })).toBe(8); // Mon (working)
    });

    it("an ignoreWeekends allocation places its hours on the weekend AND still on its working days", () => {
      const allocs = [
        makeAlloc({
          startDate: "2026-06-05",
          endDate: "2026-06-08",
          hoursPerDay: 8,
          ignoreWeekends: true,
        }),
      ];
      expect(allocatedHoursOnDay({ resource: r, date: "2026-06-05", allocations: allocs })).toBe(8); // Fri (working — still covered)
      expect(allocatedHoursOnDay({ resource: r, date: "2026-06-06", allocations: allocs })).toBe(8); // Sat (opted in)
      expect(allocatedHoursOnDay({ resource: r, date: "2026-06-07", allocations: allocs })).toBe(8); // Sun (opted in)
      expect(allocatedHoursOnDay({ resource: r, date: "2026-06-08", allocations: allocs })).toBe(8); // Mon (working — still covered)
    });
  }
  registerWeekendRuleTests();

  function registerNonWorkingWeekdayTest() {
    it("skips a non-working WEEKDAY too, not just Sat/Sun (a Mon–Wed part-timer)", () => {
      // The narrowed rule is about NON-WORKING days, not literally weekends: a Mon–Wed resource works
      // none of Thu/Fri/Sat/Sun, so a weekend-aware allocation spanning into them does no work there.
      const monWed = makeResource({ workingDays: [1, 2, 3] });
      const allocs = [
        makeAlloc({
          startDate: "2026-06-01",
          endDate: "2026-06-05",
          hoursPerDay: 8,
        }),
      ];
      expect(allocatedHoursOnDay({ resource: monWed, date: "2026-06-03", allocations: allocs })).toBe(8); // Wed (working)
      expect(allocatedHoursOnDay({ resource: monWed, date: "2026-06-04", allocations: allocs })).toBe(0); // Thu (non-working weekday)
      expect(allocatedHoursOnDay({ resource: monWed, date: "2026-06-05", allocations: allocs })).toBe(0); // Fri (non-working weekday)
    });
  }
  registerNonWorkingWeekdayTest();
});

describe("dayCapacity over-allocation", () => {
  const r = makeResource();

  function registerWeekendCapacityTests() {
    it("flags over when allocated exceeds available", () => {
      const allocs = [
        makeAlloc({
          startDate: "2026-06-01",
          endDate: "2026-06-01",
          hoursPerDay: 10,
        }),
      ];
      const cap = dayCapacity({ resource: r, date: "2026-06-01", allocations: allocs, timeOff: [] });
      expect(cap).toMatchObject({ allocated: 10, available: 8, over: true });
    });

    it("a weekend a bar merely spans is NOT over (weekends are not counted by default)", () => {
      // Fri 06-05 .. Mon 06-08 spans the weekend; the weekend-aware allocation does no work on
      // Sat/Sun, so allocated is 0 there and the day is not over (just the grey "unavailable" tint).
      const allocs = [
        makeAlloc({
          startDate: "2026-06-05",
          endDate: "2026-06-08",
          hoursPerDay: 8,
        }),
      ];
      const cap = dayCapacity({ resource: r, date: "2026-06-06", allocations: allocs, timeOff: [] }); // Saturday
      expect(cap).toMatchObject({ allocated: 0, available: 0, over: false });
    });

    it("a weekend IS over when the allocation opts in via ignoreWeekends", () => {
      // "Ignore working days" makes the hours land on Sat/Sun; a Mon–Fri person has
      // 0 weekend capacity, so that weekend work honestly reads as over.
      const allocs = [
        makeAlloc({
          startDate: "2026-06-06",
          endDate: "2026-06-06",
          hoursPerDay: 2,
          ignoreWeekends: true,
        }),
      ];
      const cap = dayCapacity({ resource: r, date: "2026-06-06", allocations: allocs, timeOff: [] }); // Saturday
      expect(cap).toMatchObject({ allocated: 2, available: 0, over: true });
    });
  }
  registerWeekendCapacityTests();

  function registerTimeOffAndWeekdayTests() {
    it("work scheduled on a time-off day is still over (a real conflict, unlike a spanned weekend)", () => {
      // Wed 06-03 is a working weekday the resource is on holiday — available 0, but the allocation
      // genuinely works that day, so it stays red. Time-off is deliberately distinct from weekends.
      const allocs = [
        makeAlloc({
          startDate: "2026-06-03",
          endDate: "2026-06-03",
          hoursPerDay: 4,
        }),
      ];
      const cap = dayCapacity({
        resource: r,
        date: "2026-06-03",
        allocations: allocs,
        timeOff: [makeTimeOff({ startDate: "2026-06-03", endDate: "2026-06-03" })],
      });
      expect(cap).toMatchObject({ allocated: 4, available: 0, over: true });
    });

    it("a part-timer's non-working WEEKDAY a bar spans is NOT over (the rule is non-working days, not just Sat/Sun)", () => {
      // Mon–Wed resource; a weekend-aware allocation spanning into Thu 06-04 does no work there.
      const monWed = makeResource({ workingDays: [1, 2, 3] });
      const allocs = [
        makeAlloc({
          startDate: "2026-06-01",
          endDate: "2026-06-05",
          hoursPerDay: 8,
        }),
      ];
      expect(dayCapacity({ resource: monWed, date: "2026-06-04", allocations: allocs, timeOff: [] })).toMatchObject({
        allocated: 0,
        available: 0,
        over: false,
      }); // Thu
      expect(dayCapacity({ resource: monWed, date: "2026-06-02", allocations: allocs, timeOff: [] }).over).toBe(false); // Tue (working, at capacity)
    });

    it("is not over when within available hours", () => {
      const allocs = [
        makeAlloc({
          startDate: "2026-06-01",
          endDate: "2026-06-01",
          hoursPerDay: 8,
        }),
      ];
      expect(dayCapacity({ resource: r, date: "2026-06-01", allocations: allocs, timeOff: [] }).over).toBe(false);
    });
  }
  registerTimeOffAndWeekdayTests();

  // The acceptance boundary: "over" is STRICTLY allocated > available. Exactly AT capacity
  // (8 vs 8) is NOT over (no red); one hour over (9 vs 8) IS over (red). Lock both ends.
  function registerStrictCapacityTests() {
    it("is NOT over when EXACTLY at capacity (8 vs 8) — the strict boundary, not red", () => {
      const allocs = [
        makeAlloc({
          startDate: "2026-06-01",
          endDate: "2026-06-01",
          hoursPerDay: 8,
        }),
      ];
      const cap = dayCapacity({ resource: r, date: "2026-06-01", allocations: allocs, timeOff: [] });
      expect(cap).toMatchObject({ allocated: 8, available: 8, over: false });
    });

    it("IS over when just one hour over capacity (9 vs 8)", () => {
      const allocs = [
        makeAlloc({
          startDate: "2026-06-01",
          endDate: "2026-06-01",
          hoursPerDay: 9,
        }),
      ];
      const cap = dayCapacity({ resource: r, date: "2026-06-01", allocations: allocs, timeOff: [] });
      expect(cap).toMatchObject({ allocated: 9, available: 8, over: true });
    });
  }
  registerStrictCapacityTests();

  function registerFractionalCapacityTest() {
    it("ignores fractional accumulation noise at exact capacity in every allocation order", () => {
      const fractional = [2, 5, 2].map((days) => (8 * days) / 9);
      const allocations = fractional.map((hoursPerDay, index) => makeAlloc({ id: `fraction-${index}`, hoursPerDay }));
      const orders = [
        [0, 1, 2],
        [0, 2, 1],
        [1, 0, 2],
        [1, 2, 0],
        [2, 0, 1],
        [2, 1, 0],
      ];
      const resource = makeResource({ workingHoursPerDay: 7.5 });

      for (const order of orders) {
        const ordered = order.map((index) => valueAt(allocations, index));
        expect(dayCapacity({ resource: resource, date: "2026-06-01", allocations: ordered, timeOff: [] }).over).toBe(
          false,
        );
        expect(
          capacityForWindow({
            resource: resource,
            allocations: ordered,
            timeOff: [],
            start: "2026-06-01",
            end: "2026-06-01",
          }).some((c) => c.over),
        ).toBe(false);
      }

      const genuinelyOver = allocations.map((allocation, index) =>
        index === 2 ? { ...allocation, hoursPerDay: allocation.hoursPerDay + 0.05 } : allocation,
      );
      expect(
        dayCapacity({ resource: resource, date: "2026-06-01", allocations: genuinelyOver, timeOff: [] }).over,
      ).toBe(true);
    });
  }
  registerFractionalCapacityTest();
});

describe("utilization", () => {
  const r = makeResource();

  function registerUtilizationBasicsTests() {
    it("reduces precomputed capacity while excluding zero-availability days", () => {
      expect(
        resolveUtilizationFromCapacity([
          { date: "2026-06-01", allocated: 4, available: 8, over: false },
          { date: "2026-06-02", allocated: 8, available: 0, over: true },
          { date: "2026-06-03", allocated: 2, available: 4, over: false },
        ]),
      ).toBeCloseTo(0.5);
    });

    it("is allocated / available over working days in the window", () => {
      // Window Mon 06-01 .. Sun 06-07: available = 5 * 8 = 40
      // Allocate 4h/day Mon–Fri = 20 -> 0.5
      const allocs = [
        makeAlloc({
          startDate: "2026-06-01",
          endDate: "2026-06-05",
          hoursPerDay: 4,
        }),
      ];
      expect(
        utilization({ resource: r, allocations: allocs, timeOff: [], start: "2026-06-01", end: "2026-06-07" }),
      ).toBeCloseTo(0.5);
    });

    it("uses mixed full and half-day capacity in the utilisation denominator", () => {
      const resource = makeResource({ workingDays: [1, 2], halfDays: [2] });
      const allocations = [makeAlloc({ startDate: "2026-06-01", endDate: "2026-06-02", hoursPerDay: 3 })];
      expect(
        utilization({
          resource: resource,
          allocations: allocations,
          timeOff: [],
          start: "2026-06-01",
          end: "2026-06-02",
        }),
      ).toBeCloseTo(0.5);
    });

    it("returns 0 when there is no availability in the window", () => {
      // A weekend-only window for a Mon–Fri resource has no availability.
      expect(
        utilization({ resource: r, allocations: [makeAlloc()], timeOff: [], start: "2026-06-06", end: "2026-06-07" }),
      ).toBe(0);
    });
  }
  registerUtilizationBasicsTests();

  function registerUtilizationWindowTests() {
    it("does not exceed 100% for a full booking that merely spans a weekend", () => {
      // Mon 06-01 .. Sun 06-14: 10 working days × 8h = 80h available. A continuous
      // 8h/day allocation across the whole window books weekend days too, but those
      // hours must not inflate the ratio — a fully-booked person reads as 100%, not 140%.
      const allocs = [
        makeAlloc({
          startDate: "2026-06-01",
          endDate: "2026-06-14",
          hoursPerDay: 8,
        }),
      ];
      expect(
        utilization({ resource: r, allocations: allocs, timeOff: [], start: "2026-06-01", end: "2026-06-14" }),
      ).toBeCloseTo(1);
    });

    it("reports one entry per calendar day of the window (capacityForWindow)", () => {
      // The straight-line oracle the memoised render path (buildSchedulerModel's per-date
      // `dayCapacity` cache over `bucketByCoveredDate`) is checked against.
      const allocs = [
        makeAlloc({
          startDate: "2026-06-01",
          endDate: "2026-06-05",
          hoursPerDay: 4,
        }),
      ];
      const days = capacityForWindow({
        resource: r,
        allocations: allocs,
        timeOff: [],
        start: "2026-06-01",
        end: "2026-06-07",
      });
      expect(days.map((d) => d.date)).toEqual(eachDayISO("2026-06-01", "2026-06-07"));
      expect(days.map((d) => d.allocated)).toEqual([4, 4, 4, 4, 4, 0, 0]);
    });

    it("does not count hours on a zero-availability day (a weekend an allocation opts into) toward the ratio", () => {
      // Sat/Sun have 0 availability for a Mon-Fri resource. An ignoreWeekends allocation still puts
      // hours there, but those days must be skipped entirely (neither side counted) — not just have
      // their availability zeroed, which would otherwise inflate the ratio via the numerator alone.
      const allocs = [
        makeAlloc({
          startDate: "2026-06-06",
          endDate: "2026-06-07",
          hoursPerDay: 4,
          ignoreWeekends: true,
        }),
      ];
      expect(
        utilization({ resource: r, allocations: allocs, timeOff: [], start: "2026-06-01", end: "2026-06-07" }),
      ).toBe(0);
    });
  }
  registerUtilizationWindowTests();

  function registerUtilizationClosureTest() {
    it("excludes a company-closure day from both sides of utilisation", () => {
      const allocations = [
        makeAlloc({ id: "monday", startDate: "2026-06-01", endDate: "2026-06-01", hoursPerDay: 8 }),
        makeAlloc({ id: "tuesday", startDate: "2026-06-02", endDate: "2026-06-02", hoursPerDay: 4 }),
      ];
      const closures = [makeClosure({ startDate: "2026-06-01", endDate: "2026-06-01" })];

      expect(
        utilization({ resource: r, allocations: allocations, timeOff: [], start: "2026-06-01", end: "2026-06-02" }),
      ).toBeCloseTo(0.75);
      expect(
        utilization({
          resource: r,
          allocations: allocations,
          timeOff: [],
          start: "2026-06-01",
          end: "2026-06-02",
          accountWorkingDays: undefined,
          closures: closures,
        }),
      ).toBeCloseTo(0.5);
    });
  }
  registerUtilizationClosureTest();
});

// The near-term "over soon" radar is a `.some(day => day.over)` over the window's capacity — the
// scheduler model runs it against its own memoised per-date capacity, so these cases pin the RULE
// (which days may read as over) on the straight-line definition both paths agree on.
describe("over-allocated inside a window", () => {
  const r = makeResource();
  const overInWindow = (allocations: Allocation[], start: ISODate, end: ISODate) =>
    capacityForWindow({ resource: r, allocations: allocations, timeOff: [], start: start, end: end }).some(
      (day) => day.over,
    );

  it("is true when a working day is genuinely over-allocated", () => {
    const allocs = [
      makeAlloc({
        startDate: "2026-06-01",
        endDate: "2026-06-01",
        hoursPerDay: 10,
      }),
    ]; // Mon, 10h > 8h
    expect(overInWindow(allocs, "2026-06-01", "2026-06-14")).toBe(true);
  });

  it("is false when an allocation only spans non-working (weekend) days", () => {
    // 8h/day Mon–Sun: every working day is exactly at capacity; the weekend hours
    // must not count as over-allocation for the near-term radar.
    const allocs = [
      makeAlloc({
        startDate: "2026-06-01",
        endDate: "2026-06-14",
        hoursPerDay: 8,
      }),
    ];
    expect(overInWindow(allocs, "2026-06-01", "2026-06-14")).toBe(false);
  });

  it("is true on a zero-capacity day when an ignoreWeekends allocation books hours there", () => {
    const allocs = [
      makeAlloc({
        startDate: "2026-06-06",
        endDate: "2026-06-06",
        hoursPerDay: 5,
        ignoreWeekends: true,
      }),
    ];
    expect(overInWindow(allocs, "2026-06-06", "2026-06-06")).toBe(true);
  });
});

describe("capacityAdvisory", () => {
  const r = makeResource();
  /** The proposed allocation under test — cases vary only its window, hours and weekend rule. */
  const proposal = ({
    startDate,
    endDate,
    hoursPerDay,
    ignoreWeekends,
  }: ProposalTestInput): CapacityAllocationInput => ({
    resourceId: r.id,
    startDate,
    endDate,
    hoursPerDay,
    ignoreWeekends,
  });

  function registerAvailabilityAdvisoryTests() {
    it("counts working days the proposed hours push over capacity", () => {
      const others = [makeAlloc({ hoursPerDay: 4 })]; // 4h Mon–Fri 06-01..05
      const { overDays, timeOffDays } = capacityAdvisory({
        resource: r,
        proposal: proposal({ startDate: "2026-06-01", endDate: "2026-06-05", hoursPerDay: 8, ignoreWeekends: false }),
        otherAllocations: others,
        timeOff: [],
      });
      expect(overDays).toBe(5); // 4 + 8 > 8 on all five weekdays
      expect(timeOffDays).toBe(0);
    });

    it("counts time-off days and excludes them from over (availability is 0 there)", () => {
      const others = [makeAlloc({ hoursPerDay: 4 })];
      const timeOff = [makeTimeOff({ startDate: "2026-06-03", endDate: "2026-06-03" })];
      const { overDays, timeOffDays } = capacityAdvisory({
        resource: r,
        proposal: proposal({ startDate: "2026-06-01", endDate: "2026-06-05", hoursPerDay: 8, ignoreWeekends: false }),
        otherAllocations: others,
        timeOff: timeOff,
      });
      expect(timeOffDays).toBe(1);
      expect(overDays).toBe(4); // 06-03 is unavailable → not "over", the other 4 weekdays are
    });

    it("counts closure dates in the same advisory category", () => {
      const closures = [makeClosure({ startDate: "2026-06-03", endDate: "2026-06-03" })];

      expect(
        capacityAdvisory({
          resource: r,
          proposal: proposal({ startDate: "2026-06-01", endDate: "2026-06-05", hoursPerDay: 8, ignoreWeekends: false }),
          otherAllocations: [],
          timeOff: [],
          accountWorkingDays: undefined,
          closures: closures,
        }),
      ).toEqual({
        overDays: 0,
        timeOffDays: 1,
      });
    });

    it("does not count time off on non-working days (a weekend holiday costs no capacity)", () => {
      // Resource works Mon–Fri; a holiday block falls only on the weekend 06-06..06-07.
      const timeOff = [makeTimeOff({ startDate: "2026-06-06", endDate: "2026-06-07" })];
      const { timeOffDays } = capacityAdvisory({
        resource: r,
        proposal: proposal({ startDate: "2026-06-01", endDate: "2026-06-07", hoursPerDay: 8, ignoreWeekends: false }),
        otherAllocations: [],
        timeOff: timeOff,
      });
      expect(timeOffDays).toBe(0); // the resource never works those days, so it's not "on time off"
    });
  }
  registerAvailabilityAdvisoryTests();

  function registerProposalBoundaryTests() {
    it("is clean when the proposal fits within availability", () => {
      expect(
        capacityAdvisory({
          resource: r,
          proposal: proposal({ startDate: "2026-06-01", endDate: "2026-06-05", hoursPerDay: 8, ignoreWeekends: false }),
          otherAllocations: [],
          timeOff: [],
        }),
      ).toEqual({
        overDays: 0,
        timeOffDays: 0,
      });
    });

    it("treats exactly four hours as fitting a half day and anything above as over", () => {
      const resource = makeResource({ halfDays: [2] });
      expect(
        capacityAdvisory({
          resource: resource,
          proposal: proposal({ startDate: "2026-06-02", endDate: "2026-06-02", hoursPerDay: 4, ignoreWeekends: false }),
          otherAllocations: [],
          timeOff: [],
        }).overDays,
      ).toBe(0);
      expect(
        capacityAdvisory({
          resource: resource,
          proposal: proposal({
            startDate: "2026-06-02",
            endDate: "2026-06-02",
            hoursPerDay: 4.01,
            ignoreWeekends: false,
          }),
          otherAllocations: [],
          timeOff: [],
        }).overDays,
      ).toBe(1);
    });
  }
  registerProposalBoundaryTests();

  function registerFractionalAdvisoryTest() {
    it("does not advise over-capacity for an exact fractional days-mode split", () => {
      const resource = makeResource({ workingHoursPerDay: 7.5 });
      const fractional = [2, 5, 2].map((days) => (8 * days) / 9);
      const others = fractional
        .slice(0, 2)
        .map((hoursPerDay, index) => makeAlloc({ id: `existing-fraction-${index}`, hoursPerDay }));

      expect(
        capacityAdvisory({
          resource: resource,
          proposal: proposal({
            startDate: "2026-06-01",
            endDate: "2026-06-01",
            hoursPerDay: valueAt(fractional, 2),
            ignoreWeekends: false,
          }),
          otherAllocations: others,
          timeOff: [],
        }).overDays,
      ).toBe(0);
      expect(
        capacityAdvisory({
          resource: resource,
          proposal: proposal({
            startDate: "2026-06-01",
            endDate: "2026-06-01",
            hoursPerDay: valueAt(fractional, 2) + 0.05,
            ignoreWeekends: false,
          }),
          otherAllocations: others,
          timeOff: [],
        }).overDays,
      ).toBe(1);
    });
  }
  registerFractionalAdvisoryTest();

  function registerWeekendAdvisoryTests() {
    it("mirrors the over-marker for an ignoreWeekends weekend; weekend-aware does not", () => {
      // Fri–Sun: a weekend-aware proposal leaves Sat/Sun uncounted, but opting into weekends flags
      // them — a Mon–Fri person has 0 weekend capacity, so the advisory matches the red over-marker.
      expect(
        capacityAdvisory({
          resource: r,
          proposal: proposal({ startDate: "2026-06-05", endDate: "2026-06-07", hoursPerDay: 8, ignoreWeekends: false }),
          otherAllocations: [],
          timeOff: [],
        }).overDays,
      ).toBe(0);
      expect(
        capacityAdvisory({
          resource: r,
          proposal: proposal({ startDate: "2026-06-05", endDate: "2026-06-07", hoursPerDay: 8, ignoreWeekends: true }),
          otherAllocations: [],
          timeOff: [],
        }).overDays,
      ).toBe(2);
    });

    it("returns the zeroed advisory when the window is empty (start after end)", () => {
      expect(
        capacityAdvisory({
          resource: r,
          proposal: proposal({ startDate: "2026-06-05", endDate: "2026-06-01", hoursPerDay: 8, ignoreWeekends: false }),
          otherAllocations: [],
          timeOff: [],
        }),
      ).toEqual({
        overDays: 0,
        timeOffDays: 0,
      });
    });

    it("returns before expanding a proposed window beyond the shared calendar-span bound", () => {
      const start = "2026-01-01";
      expect(
        capacityAdvisory({
          resource: r,
          proposal: proposal({
            startDate: start,
            endDate: addDaysISO(start, MAX_SPAN_DAYS),
            hoursPerDay: 8,
            ignoreWeekends: false,
          }),
          otherAllocations: [],
          timeOff: [],
        }),
      ).toEqual({
        overDays: 0,
        timeOffDays: 0,
      });
    });
  }
  registerWeekendAdvisoryTests();

  function registerWindowClampTests() {
    it("clamps an existing allocation to the window start (does not count its hours before start)", () => {
      // The other allocation starts mid-window (Wed); its hours must not leak onto Mon/Tue.
      const others = [
        makeAlloc({
          startDate: "2026-06-03",
          endDate: "2026-06-03",
          hoursPerDay: 4,
        }),
      ];
      const { overDays } = capacityAdvisory({
        resource: r,
        proposal: proposal({ startDate: "2026-06-01", endDate: "2026-06-03", hoursPerDay: 5, ignoreWeekends: false }),
        otherAllocations: others,
        timeOff: [],
      });
      expect(overDays).toBe(1); // only Wed (4 + 5 > 8); Mon/Tue see 0 + 5, not over
    });

    it("clamps an existing allocation to the window end (does not count its hours after it ends)", () => {
      // The other allocation ends on day one (Mon); its hours must not leak onto Tue/Wed.
      const others = [
        makeAlloc({
          startDate: "2026-06-01",
          endDate: "2026-06-01",
          hoursPerDay: 4,
        }),
      ];
      const { overDays } = capacityAdvisory({
        resource: r,
        proposal: proposal({ startDate: "2026-06-01", endDate: "2026-06-03", hoursPerDay: 5, ignoreWeekends: false }),
        otherAllocations: others,
        timeOff: [],
      });
      expect(overDays).toBe(1); // only Mon (4 + 5 > 8); Tue/Wed see 0 + 5, not over
    });

    it("ignores allocations belonging to another resource (callers need not pre-filter)", () => {
      // The advisory's per-day mirror (allocatedHoursOnDay) scopes by resource; this must too, so a
      // caller handing over an unfiltered list cannot have someone else's 8h read as this person's.
      const others = [
        makeAlloc({ id: "someone-else", resourceId: "r2", hoursPerDay: 8 }),
        makeAlloc({ id: "ours", hoursPerDay: 4 }),
      ];
      const { overDays } = capacityAdvisory({
        resource: r,
        proposal: proposal({ startDate: "2026-06-01", endDate: "2026-06-05", hoursPerDay: 4, ignoreWeekends: false }),
        otherAllocations: others,
        timeOff: [],
      });
      expect(overDays).toBe(0); // 4 (ours) + 4 (proposed) fits in 8; r2's 8h must not be counted
    });
  }
  registerWindowClampTests();

  function registerBlocksAdvisoryTests() {
    it("reads a blocks-mode projection of legacy hourly allocations as zero load", () => {
      // What the modal / grid / drag path all feed in once an account switches to blocks: the stored
      // hours stay on the row, but capacityAllocationsForMode projects them to 0 before counting.
      const legacy = [makeAlloc({ hoursPerDay: 8 })];
      expect(
        capacityAdvisory({
          resource: r,
          proposal: proposal({ startDate: "2026-06-01", endDate: "2026-06-05", hoursPerDay: 0, ignoreWeekends: false }),
          otherAllocations: legacy,
          timeOff: [],
        }).overDays,
      ).toBe(0);
      // Blocks propose 0 load too, so nothing is over — whereas the RAW hourly rows would flag
      // nothing here either; the difference shows when the proposal itself carries hours.
      expect(
        capacityAdvisory({
          resource: r,
          proposal: proposal({ startDate: "2026-06-01", endDate: "2026-06-05", hoursPerDay: 1, ignoreWeekends: false }),
          otherAllocations: legacy,
          timeOff: [],
        }).overDays,
      ).toBe(5);
      const projected = applyCapacityMode({ allocations: legacy, blocksMode: true });
      expect(
        capacityAdvisory({
          resource: r,
          proposal: proposal({ startDate: "2026-06-01", endDate: "2026-06-05", hoursPerDay: 1, ignoreWeekends: false }),
          otherAllocations: projected,
          timeOff: [],
        }).overDays,
      ).toBe(0);
    });

    it("does not count an existing weekend-aware allocation on a weekend day it merely spans", () => {
      // The other allocation spans Fri-Mon but (weekend-aware, no ignoreWeekends) does no work on
      // Sat. The proposal opts INTO the weekend via ignoreWeekends with 0 hours, so a spurious
      // carry-over of the other allocation's hours onto Sat would wrongly flag it as over.
      const others = [
        makeAlloc({
          startDate: "2026-06-05",
          endDate: "2026-06-08",
          hoursPerDay: 8,
        }),
      ];
      const { overDays } = capacityAdvisory({
        resource: r,
        proposal: proposal({ startDate: "2026-06-06", endDate: "2026-06-06", hoursPerDay: 0, ignoreWeekends: true }),
        otherAllocations: others,
        timeOff: [],
      });
      expect(overDays).toBe(0);
    });
  }
  registerBlocksAdvisoryTests();
});

describe("isHalfDay", () => {
  it("reads the resource's saved half-day pattern for a weekday", () => {
    const r = makeResource({ halfDays: [3] });
    expect(isHalfDay(r, 3)).toBe(true);
    expect(isHalfDay(r, 2)).toBe(false);
  });
});

describe("formatCapacityAdvisory", () => {
  it("says nothing when neither count is set", () => {
    expect(formatCapacityAdvisory({ overDays: 0, timeOffDays: 0 }, "toast")).toBe("");
    expect(formatCapacityAdvisory({ overDays: 0, timeOffDays: 0 }, "form")).toBe("");
  });

  it("names the over-capacity bit before the time-off bit, joined and wrapped per surface", () => {
    expect(formatCapacityAdvisory({ overDays: 2, timeOffDays: 1 }, "toast")).toBe(
      " — now over capacity on 2 days and on time off for 1 day",
    );
    expect(formatCapacityAdvisory({ overDays: 1, timeOffDays: 0 }, "form")).toBe(
      "This allocation is over capacity on 1 day. Saving is still allowed.",
    );
  });

  it("counts allocations, not days, on the repeat surface", () => {
    expect(formatCapacityAdvisory({ overDays: 0, timeOffDays: 3 }, "repeat")).toBe(
      "For this repeat, 3 allocations overlap time off. Saving is still allowed.",
    );
  });

  it("appends the repeat-only non-effective-start count as the third sentence fragment", () => {
    expect(formatCapacityAdvisory({ overDays: 1, timeOffDays: 2, nonEffectiveStartAllocations: 3 }, "repeat")).toBe(
      "For this repeat, 1 allocation may exceed capacity and 2 allocations overlap time off and 3 allocations start on a non-working day. Saving is still allowed.",
    );
  });
});
