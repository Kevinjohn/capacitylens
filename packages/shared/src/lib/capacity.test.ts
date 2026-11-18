import { describe, it, expect } from 'vitest';
import { applyCapacityMode, isOnTimeOff, resolveUtilizationFromCapacity } from './capacity.js';
import { eachDayISO } from './dateMath.js';
import type { Allocation, ISODate, Resource, Weekday } from '../types/entities.js';

import {
  valueAt,
  scheduledHoursOnDay,
  availableHoursOnDay,
  allocatedHoursOnDay,
  dayCapacity,
  capacityForWindow,
  utilization,
  capacityAdvisory,
  makeResource,
  makeAlloc,
  makeTimeOff,
  makeClosure,
  makeProposal,
} from './capacity/capacity.test.support.js';
import type { CapacityCaseInput } from './capacity/capacity.test.support.js';

function registerSemanticsTableTests(
  cases: readonly CapacityCaseInput[],
  resource: Resource,
  companyMondayOnly: Weekday[],
) {
  it.each(cases)(
    'implements $name',
    ({ date, allocations, timeOff, expected }: CapacityCaseInput) => {
      expect(
        dayCapacity({
          resource,
          date,
          allocations: [...allocations],
          timeOff: [...timeOff],
          accountWorkingDays: companyMondayOnly,
        }),
      ).toMatchObject(expected);
      expect(isOnTimeOff(resource.id, date, [...timeOff])).toBe(timeOff.length > 0);
    },
  );
}

function buildEffectiveDayCases(monday: ISODate): readonly CapacityCaseInput[] {
  const normalMonday = [makeAlloc({ startDate: monday, endDate: monday, hoursPerDay: 8 })];
  const mondayOff = [makeTimeOff({ startDate: monday, endDate: monday })];
  return [
    {
      name: 'normal allocation on an effective day',
      date: monday,
      allocations: normalMonday,
      timeOff: [],
      expected: { allocated: 8, available: 8, over: false },
    },
    {
      name: 'normal allocation over time off on an effective day',
      date: monday,
      allocations: normalMonday,
      timeOff: mondayOff,
      expected: { allocated: 8, available: 0, over: true },
    },
  ] as const;
}

function buildCompanyDayOffCases(monday: ISODate, friday: ISODate): readonly CapacityCaseInput[] {
  const mondayOff = [makeTimeOff({ startDate: monday, endDate: monday })];
  const fridayOff = [makeTimeOff({ startDate: friday, endDate: friday })];
  const normalMonday = [makeAlloc({ startDate: monday, endDate: monday, hoursPerDay: 8 })];
  const normalFriday = [makeAlloc({ startDate: friday, endDate: friday, hoursPerDay: 8 })];
  const ignoredFriday = [
    makeAlloc({ startDate: friday, endDate: friday, hoursPerDay: 8, ignoreWorkingDays: true }),
  ];
  const blockMonday = applyCapacityMode({ allocations: normalMonday, blocksMode: true });
  const blockFriday = applyCapacityMode({ allocations: normalFriday, blocksMode: true });
  return [
    {
      name: 'normal allocation on a company day off',
      date: friday,
      allocations: normalFriday,
      timeOff: [],
      expected: { allocated: 0, available: 0, over: false },
    },
    {
      name: 'normal allocation on a company day off plus time off',
      date: friday,
      allocations: normalFriday,
      timeOff: fridayOff,
      expected: { allocated: 0, available: 0, over: false },
    },
    {
      name: 'ignored allocation on a company day off',
      date: friday,
      allocations: ignoredFriday,
      timeOff: [],
      expected: { allocated: 8, available: 0, over: true },
    },
    {
      name: 'ignored allocation on a company day off plus time off',
      date: friday,
      allocations: ignoredFriday,
      timeOff: fridayOff,
      expected: { allocated: 8, available: 0, over: true },
    },
    {
      name: 'zero-load block on a company day off',
      date: friday,
      allocations: blockFriday,
      timeOff: [],
      expected: { allocated: 0, available: 0, over: false },
    },
    {
      name: 'zero-load block over time off',
      date: monday,
      allocations: blockMonday,
      timeOff: mondayOff,
      expected: { allocated: 0, available: 0, over: false },
    },
  ] as const;
}

describe('#257 characterization: effective-week capacity', () => {
  // Effective company and personal calendars determine which covered days count as load.
  it('removes Friday capacity, load and utilisation when the company calendar excludes Friday', () => {
    const accountWorkingDays: Weekday[] = [1, 2, 3, 4];
    const resource = makeResource({ workingDays: [1, 2, 3, 4, 5] });
    const allocation = makeAlloc({
      startDate: '2026-06-01',
      endDate: '2026-06-05',
      hoursPerDay: 8,
    });

    expect(scheduledHoursOnDay(resource, '2026-06-05', accountWorkingDays)).toBe(0);
    expect(
      availableHoursOnDay({
        resource,
        date: '2026-06-05',
        timeOff: [],
        accountWorkingDays,
      }),
    ).toBe(0);
    expect(
      allocatedHoursOnDay({
        resource,
        date: '2026-06-05',
        allocations: [allocation],
        accountWorkingDays,
      }),
    ).toBe(0);
    expect(
      utilization({
        resource,
        allocations: [allocation],
        timeOff: [],
        start: '2026-06-05',
        end: '2026-06-05',
        accountWorkingDays,
      }),
    ).toBe(0);
  });

  // Intersecting a resource week with a partial company week excludes non-effective days from load.
  it('does not load Saturday and Sunday for a normal allocation on a seven-day resource', () => {
    const resource = makeResource({ workingDays: [0, 1, 2, 3, 4, 5, 6] });
    const allocation = makeAlloc({
      startDate: '2026-06-01',
      endDate: '2026-06-07',
      hoursPerDay: 8,
    });

    expect(allocatedHoursOnDay({ resource, date: '2026-06-06', allocations: [allocation] })).toBe(
      0,
    );
    expect(allocatedHoursOnDay({ resource, date: '2026-06-07', allocations: [allocation] })).toBe(
      0,
    );
  });
});

describe('effective working-week semantics table', () => {
  const resource = makeResource();
  const monday = '2026-06-01' as ISODate;
  const friday = '2026-06-05' as ISODate;
  const companyMondayOnly: Weekday[] = [1];
  registerSemanticsTableTests(buildEffectiveDayCases(monday), resource, companyMondayOnly);
  registerSemanticsTableTests(buildCompanyDayOffCases(monday, friday), resource, companyMondayOnly);
  it('keeps a none-week resource at zero capacity and normal load while ignored load remains calendar-day work', () => {
    const noneCompanyWeek: Weekday[] = [];
    const normal = [makeAlloc({ startDate: monday, endDate: monday, hoursPerDay: 8 })];
    const ignored = [
      makeAlloc({ startDate: monday, endDate: monday, hoursPerDay: 8, ignoreWorkingDays: true }),
    ];

    expect(scheduledHoursOnDay(resource, monday, noneCompanyWeek)).toBe(0);
    expect(
      availableHoursOnDay({
        resource,
        date: monday,
        timeOff: [],
        accountWorkingDays: noneCompanyWeek,
      }),
    ).toBe(0);
    expect(
      allocatedHoursOnDay({
        resource,
        date: monday,
        allocations: normal,
        accountWorkingDays: noneCompanyWeek,
      }),
    ).toBe(0);
    expect(
      dayCapacity({
        resource,
        date: monday,
        allocations: normal,
        timeOff: [],
        accountWorkingDays: noneCompanyWeek,
      }).over,
    ).toBe(false);
    expect(
      allocatedHoursOnDay({
        resource,
        date: monday,
        allocations: ignored,
        accountWorkingDays: noneCompanyWeek,
      }),
    ).toBe(8);
    expect(
      dayCapacity({
        resource,
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
});

describe('dayCapacity over-allocation', () => {
  const r = makeResource();
  it('flags over when allocated exceeds available', () => {
    const allocs = [
      makeAlloc({
        startDate: '2026-06-01',
        endDate: '2026-06-01',
        hoursPerDay: 10,
      }),
    ];
    const cap = dayCapacity({ resource: r, date: '2026-06-01', allocations: allocs, timeOff: [] });
    expect(cap).toMatchObject({ allocated: 10, available: 8, over: true });
  });

  it('a weekend a bar merely spans is NOT over (weekends are not counted by default)', () => {
    // Fri 06-05 .. Mon 06-08 spans the weekend; the weekend-aware allocation does no work on
    // Sat/Sun, so allocated is 0 there and the day is not over (just the grey "unavailable" tint).
    const allocs = [
      makeAlloc({
        startDate: '2026-06-05',
        endDate: '2026-06-08',
        hoursPerDay: 8,
      }),
    ];
    const cap = dayCapacity({ resource: r, date: '2026-06-06', allocations: allocs, timeOff: [] });
    expect(cap).toMatchObject({ allocated: 0, available: 0, over: false });
  });

  it('a weekend IS over when the allocation opts in via ignoreWorkingDays', () => {
    // "Ignore working days" makes the hours land on Sat/Sun; a Mon–Fri person has
    // 0 weekend capacity, so that weekend work honestly reads as over.
    const allocs = [
      makeAlloc({
        startDate: '2026-06-06',
        endDate: '2026-06-06',
        hoursPerDay: 2,
        ignoreWorkingDays: true,
      }),
    ];
    const cap = dayCapacity({ resource: r, date: '2026-06-06', allocations: allocs, timeOff: [] });
    expect(cap).toMatchObject({ allocated: 2, available: 0, over: true });
  });

  it('work scheduled on a time-off day is still over (a real conflict, unlike a spanned weekend)', () => {
    // Wed 06-03 is a working weekday the resource is on holiday (available 0), but the allocation
    // genuinely works that day, so it stays red. Time-off is deliberately distinct from weekends.
    const allocs = [
      makeAlloc({
        startDate: '2026-06-03',
        endDate: '2026-06-03',
        hoursPerDay: 4,
      }),
    ];
    const cap = dayCapacity({
      resource: r,
      date: '2026-06-03',
      allocations: allocs,
      timeOff: [makeTimeOff({ startDate: '2026-06-03', endDate: '2026-06-03' })],
    });
    expect(cap).toMatchObject({ allocated: 4, available: 0, over: true });
  });

  it("a part-timer's non-working WEEKDAY a bar spans is NOT over (the rule is non-working days, not just Sat/Sun)", () => {
    const monWed = makeResource({ workingDays: [1, 2, 3] });
    const allocs = [
      makeAlloc({
        startDate: '2026-06-01',
        endDate: '2026-06-05',
        hoursPerDay: 8,
      }),
    ];
    expect(
      dayCapacity({ resource: monWed, date: '2026-06-04', allocations: allocs, timeOff: [] }),
    ).toMatchObject({
      allocated: 0,
      available: 0,
      over: false,
    });
    expect(
      dayCapacity({ resource: monWed, date: '2026-06-02', allocations: allocs, timeOff: [] }).over,
    ).toBe(false);
  });

  it('is not over when within available hours', () => {
    const allocs = [
      makeAlloc({
        startDate: '2026-06-01',
        endDate: '2026-06-01',
        hoursPerDay: 8,
      }),
    ];
    expect(
      dayCapacity({ resource: r, date: '2026-06-01', allocations: allocs, timeOff: [] }).over,
    ).toBe(false);
  });

  // Equality must remain within capacity; only strictly greater allocation marks a conflict.
  it('is NOT over when EXACTLY at capacity (8 vs 8) — the strict boundary, not red', () => {
    const allocs = [
      makeAlloc({
        startDate: '2026-06-01',
        endDate: '2026-06-01',
        hoursPerDay: 8,
      }),
    ];
    const cap = dayCapacity({
      resource: r,
      date: '2026-06-01',
      allocations: allocs,
      timeOff: [],
    });
    expect(cap).toMatchObject({ allocated: 8, available: 8, over: false });
  });

  it('IS over when just one hour over capacity (9 vs 8)', () => {
    const allocs = [
      makeAlloc({
        startDate: '2026-06-01',
        endDate: '2026-06-01',
        hoursPerDay: 9,
      }),
    ];
    const cap = dayCapacity({
      resource: r,
      date: '2026-06-01',
      allocations: allocs,
      timeOff: [],
    });
    expect(cap).toMatchObject({ allocated: 9, available: 8, over: true });
  });

  it('ignores fractional accumulation noise at exact capacity in every allocation order', () => {
    const fractional = [2, 5, 2].map((days) => (8 * days) / 9);
    const allocations = fractional.map((hoursPerDay, index) =>
      makeAlloc({ id: `fraction-${index}`, hoursPerDay }),
    );
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
      expect(
        dayCapacity({ resource, date: '2026-06-01', allocations: ordered, timeOff: [] }).over,
      ).toBe(false);
      expect(
        capacityForWindow({
          resource,
          allocations: ordered,
          timeOff: [],
          start: '2026-06-01',
          end: '2026-06-01',
        }).some((c) => c.over),
      ).toBe(false);
    }

    const genuinelyOver = allocations.map((allocation, index) =>
      index === 2 ? { ...allocation, hoursPerDay: allocation.hoursPerDay + 0.05 } : allocation,
    );
    expect(
      dayCapacity({
        resource,
        date: '2026-06-01',
        allocations: genuinelyOver,
        timeOff: [],
      }).over,
    ).toBe(true);
  });
});

describe('utilization', () => {
  const r = makeResource();
  it('reduces precomputed capacity while excluding zero-availability days', () => {
    expect(
      resolveUtilizationFromCapacity([
        { date: '2026-06-01', allocated: 4, available: 8, over: false },
        { date: '2026-06-02', allocated: 8, available: 0, over: true },
        { date: '2026-06-03', allocated: 2, available: 4, over: false },
      ]),
    ).toBeCloseTo(0.5);
  });

  it('is allocated / available over working days in the window', () => {
    const allocs = [
      makeAlloc({
        startDate: '2026-06-01',
        endDate: '2026-06-05',
        hoursPerDay: 4,
      }),
    ];
    expect(
      utilization({
        resource: r,
        allocations: allocs,
        timeOff: [],
        start: '2026-06-01',
        end: '2026-06-07',
      }),
    ).toBeCloseTo(0.5);
  });

  it('uses mixed full and half-day capacity in the utilisation denominator', () => {
    const resource = makeResource({ workingDays: [1, 2], halfDays: [2] });
    const allocations = [
      makeAlloc({ startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 3 }),
    ];
    expect(
      utilization({
        resource,
        allocations,
        timeOff: [],
        start: '2026-06-01',
        end: '2026-06-02',
      }),
    ).toBeCloseTo(0.5);
  });

  it('returns 0 when there is no availability in the window', () => {
    expect(
      utilization({
        resource: r,
        allocations: [makeAlloc()],
        timeOff: [],
        start: '2026-06-06',
        end: '2026-06-07',
      }),
    ).toBe(0);
  });

  it('does not exceed 100% for a full booking that merely spans a weekend', () => {
    // Mon 06-01 .. Sun 06-14: 10 working days × 8h = 80h available. A continuous
    // 8h/day allocation spans the whole window but works only the normal working days.
    // A fully-booked person reads as 100%; the spanned weekend adds no work.
    const allocs = [
      makeAlloc({
        startDate: '2026-06-01',
        endDate: '2026-06-14',
        hoursPerDay: 8,
      }),
    ];
    expect(
      utilization({
        resource: r,
        allocations: allocs,
        timeOff: [],
        start: '2026-06-01',
        end: '2026-06-14',
      }),
    ).toBeCloseTo(1);
  });

  it('reports one entry per calendar day of the window (capacityForWindow)', () => {
    // The straight-line oracle the memoised render path (buildSchedulerModel's per-date
    // `dayCapacity` cache over `bucketByCoveredDate`) is checked against.
    const allocs = [
      makeAlloc({
        startDate: '2026-06-01',
        endDate: '2026-06-05',
        hoursPerDay: 4,
      }),
    ];
    const days = capacityForWindow({
      resource: r,
      allocations: allocs,
      timeOff: [],
      start: '2026-06-01',
      end: '2026-06-07',
    });
    expect(days.map((d) => d.date)).toEqual(eachDayISO('2026-06-01', '2026-06-07'));
    expect(days.map((d) => d.allocated)).toEqual([4, 4, 4, 4, 4, 0, 0]);
  });

  it('does not count hours on a zero-availability day (a weekend an allocation opts into) toward the ratio', () => {
    // Sat/Sun have 0 availability for a Mon-Fri resource. An ignoreWorkingDays allocation still puts
    // hours there, but those days must be skipped entirely (neither side counted), not just have
    // their availability zeroed, which would otherwise inflate the ratio via the numerator alone.
    const allocs = [
      makeAlloc({
        startDate: '2026-06-06',
        endDate: '2026-06-07',
        hoursPerDay: 4,
        ignoreWorkingDays: true,
      }),
    ];
    expect(
      utilization({
        resource: r,
        allocations: allocs,
        timeOff: [],
        start: '2026-06-01',
        end: '2026-06-07',
      }),
    ).toBe(0);
  });

  it('excludes a company-closure day from both sides of utilisation', () => {
    const allocations = [
      makeAlloc({ id: 'monday', startDate: '2026-06-01', endDate: '2026-06-01', hoursPerDay: 8 }),
      makeAlloc({
        id: 'tuesday',
        startDate: '2026-06-02',
        endDate: '2026-06-02',
        hoursPerDay: 4,
      }),
    ];
    const closures = [makeClosure({ startDate: '2026-06-01', endDate: '2026-06-01' })];

    expect(
      utilization({
        resource: r,
        allocations,
        timeOff: [],
        start: '2026-06-01',
        end: '2026-06-02',
      }),
    ).toBeCloseTo(0.75);
    expect(
      utilization({
        resource: r,
        allocations,
        timeOff: [],
        start: '2026-06-01',
        end: '2026-06-02',
        accountWorkingDays: undefined,
        closures,
      }),
    ).toBeCloseTo(0.5);
  });
});

// The model and straight-line capacity oracle must agree on which days count as over capacity.
describe('over-allocated inside a window', () => {
  const r = makeResource();
  const overInWindow = (allocations: Allocation[], start: ISODate, end: ISODate) =>
    capacityForWindow({
      resource: r,
      allocations,
      timeOff: [],
      start,
      end,
    }).some((day) => day.over);

  it('is true when a working day is genuinely over-allocated', () => {
    const allocs = [
      makeAlloc({
        startDate: '2026-06-01',
        endDate: '2026-06-01',
        hoursPerDay: 10,
      }),
    ];
    expect(overInWindow(allocs, '2026-06-01', '2026-06-14')).toBe(true);
  });

  it('is false when an allocation only spans non-working (weekend) days', () => {
    const allocs = [
      makeAlloc({
        startDate: '2026-06-01',
        endDate: '2026-06-14',
        hoursPerDay: 8,
      }),
    ];
    expect(overInWindow(allocs, '2026-06-01', '2026-06-14')).toBe(false);
  });

  it('is true on a zero-capacity day when an ignoreWorkingDays allocation books hours there', () => {
    const allocs = [
      makeAlloc({
        startDate: '2026-06-06',
        endDate: '2026-06-06',
        hoursPerDay: 5,
        ignoreWorkingDays: true,
      }),
    ];
    expect(overInWindow(allocs, '2026-06-06', '2026-06-06')).toBe(true);
  });
});

it('reports a real sub-nanohour overload in both the day marker and proposal advisory', () => {
  const resource = makeResource();
  const allocation = makeAlloc({ hoursPerDay: 8 + 1e-10 });
  expect(
    dayCapacity({ resource, date: '2026-06-01', allocations: [allocation], timeOff: [] }).over,
  ).toBe(true);
  expect(
    capacityAdvisory({
      resource,
      proposal: makeProposal(resource)({
        startDate: '2026-06-01',
        endDate: '2026-06-01',
        hoursPerDay: 1e-10,
        ignoreWorkingDays: false,
      }),
      otherAllocations: [makeAlloc({ hoursPerDay: 8 })],
      timeOff: [],
    }).overDays,
  ).toBe(1);
});

it('does not mark a day over when days-mode bookings fit it exactly', () => {
  const resource = makeResource();
  // One day of work over five working days stores 1.6 h/day; five of them are 8 h in decimal but a
  // hair above 8 h in binary, which the marker and the advisory must both read as full, not over.
  const allocations = Array.from({ length: 5 }, (_, index) =>
    makeAlloc({ id: `fit-${index}`, hoursPerDay: 1.6 }),
  );
  expect(dayCapacity({ resource, date: '2026-06-01', allocations, timeOff: [] }).over).toBe(false);
  expect(
    capacityAdvisory({
      resource,
      proposal: makeProposal(resource)({
        startDate: '2026-06-01',
        endDate: '2026-06-01',
        hoursPerDay: 1.6,
        ignoreWorkingDays: false,
      }),
      otherAllocations: allocations.slice(0, 4),
      timeOff: [],
    }).overDays,
  ).toBe(0);
});

it.each(
  [[8 + 1e-12], [8 + 1e-12, ...Array<number>(100).fill(0)], [8, 1e-12]].map((hours) => [hours]),
)(
  'preserves real positive excess through marker and advisory despite zero operands: %j',
  (hours) => {
    const resource = makeResource();
    const allocations = hours.map((hoursPerDay, index) =>
      makeAlloc({ id: `exact-${index}`, hoursPerDay }),
    );
    expect(dayCapacity({ resource, date: '2026-06-01', allocations, timeOff: [] }).over).toBe(true);
    const proposalHours = hours.at(-1) ?? 0;
    expect(
      capacityAdvisory({
        resource,
        proposal: makeProposal(resource)({
          startDate: '2026-06-01',
          endDate: '2026-06-01',
          hoursPerDay: proposalHours,
          ignoreWorkingDays: false,
        }),
        otherAllocations: allocations.slice(0, -1),
        timeOff: [],
      }).overDays,
    ).toBe(1);
  },
);
