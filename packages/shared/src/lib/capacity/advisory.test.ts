import { describe, it, expect } from 'vitest';
import { applyCapacityMode } from '../capacity.js';
import { addDaysISO } from '../dateMath.js';
import { MAX_SPAN_DAYS } from '../schedulingDays.js';

import {
  valueAt,
  capacityAdvisory,
  makeResource,
  makeAlloc,
  makeTimeOff,
  makeClosure,
  makeProposal,
} from './capacity.test.support.js';

describe('capacityAdvisory', () => {
  const r = makeResource();
  const proposal = makeProposal(r);
  it('counts working days the proposed hours push over capacity', () => {
    const others = [makeAlloc({ hoursPerDay: 4 })];
    const { overDays, timeOffDays } = capacityAdvisory({
      resource: r,
      proposal: proposal({
        startDate: '2026-06-01',
        endDate: '2026-06-05',
        hoursPerDay: 8,
        ignoreWorkingDays: false,
      }),
      otherAllocations: others,
      timeOff: [],
    });
    expect(overDays).toBe(5);
    expect(timeOffDays).toBe(0);
  });

  it("reports retained load outside the person's availability as over capacity", () => {
    const bounded = makeResource({ firstAvailableDate: '2026-06-03' });
    const { overDays } = capacityAdvisory({
      resource: bounded,
      proposal: makeProposal(bounded)({
        startDate: '2026-06-01',
        endDate: '2026-06-03',
        hoursPerDay: 8,
        ignoreWorkingDays: false,
      }),
      otherAllocations: [],
      timeOff: [],
    });

    expect(overDays).toBe(2);
  });
  it('counts time-off days and excludes them from over (availability is 0 there)', () => {
    const others = [makeAlloc({ hoursPerDay: 4 })];
    const timeOff = [makeTimeOff({ startDate: '2026-06-03', endDate: '2026-06-03' })];
    const { overDays, timeOffDays } = capacityAdvisory({
      resource: r,
      proposal: proposal({
        startDate: '2026-06-01',
        endDate: '2026-06-05',
        hoursPerDay: 8,
        ignoreWorkingDays: false,
      }),
      otherAllocations: others,
      timeOff,
    });
    expect(timeOffDays).toBe(1);
    expect(overDays).toBe(4);
  });

  it('counts closure dates in the same advisory category', () => {
    const closures = [makeClosure({ startDate: '2026-06-03', endDate: '2026-06-03' })];

    expect(
      capacityAdvisory({
        resource: r,
        proposal: proposal({
          startDate: '2026-06-01',
          endDate: '2026-06-05',
          hoursPerDay: 8,
          ignoreWorkingDays: false,
        }),
        otherAllocations: [],
        timeOff: [],
        accountWorkingDays: undefined,
        closures,
      }),
    ).toEqual({
      overDays: 0,
      timeOffDays: 1,
    });
  });

  it('does not count time off on non-working days (a weekend holiday costs no capacity)', () => {
    const timeOff = [makeTimeOff({ startDate: '2026-06-06', endDate: '2026-06-07' })];
    const { timeOffDays } = capacityAdvisory({
      resource: r,
      proposal: proposal({
        startDate: '2026-06-01',
        endDate: '2026-06-07',
        hoursPerDay: 8,
        ignoreWorkingDays: false,
      }),
      otherAllocations: [],
      timeOff,
    });
    expect(timeOffDays).toBe(0);
  });

  it('is clean when the proposal fits within availability', () => {
    expect(
      capacityAdvisory({
        resource: r,
        proposal: proposal({
          startDate: '2026-06-01',
          endDate: '2026-06-05',
          hoursPerDay: 8,
          ignoreWorkingDays: false,
        }),
        otherAllocations: [],
        timeOff: [],
      }),
    ).toEqual({
      overDays: 0,
      timeOffDays: 0,
    });
  });

  it('treats exactly four hours as fitting a half day and anything above as over', () => {
    const resource = makeResource({ halfDays: [2] });
    expect(
      capacityAdvisory({
        resource,
        proposal: proposal({
          startDate: '2026-06-02',
          endDate: '2026-06-02',
          hoursPerDay: 4,
          ignoreWorkingDays: false,
        }),
        otherAllocations: [],
        timeOff: [],
      }).overDays,
    ).toBe(0);
    expect(
      capacityAdvisory({
        resource,
        proposal: proposal({
          startDate: '2026-06-02',
          endDate: '2026-06-02',
          hoursPerDay: 4.01,
          ignoreWorkingDays: false,
        }),
        otherAllocations: [],
        timeOff: [],
      }).overDays,
    ).toBe(1);
  });

  it('does not advise over-capacity for an exact fractional days-mode split', () => {
    const resource = makeResource({ workingHoursPerDay: 7.5 });
    const fractional = [2, 5, 2].map((days) => (8 * days) / 9);
    const others = fractional
      .slice(0, 2)
      .map((hoursPerDay, index) => makeAlloc({ id: `existing-fraction-${index}`, hoursPerDay }));

    expect(
      capacityAdvisory({
        resource,
        proposal: proposal({
          startDate: '2026-06-01',
          endDate: '2026-06-01',
          hoursPerDay: valueAt(fractional, 2),
          ignoreWorkingDays: false,
        }),
        otherAllocations: others,
        timeOff: [],
      }).overDays,
    ).toBe(0);
    expect(
      capacityAdvisory({
        resource,
        proposal: proposal({
          startDate: '2026-06-01',
          endDate: '2026-06-01',
          hoursPerDay: valueAt(fractional, 2) + 0.05,
          ignoreWorkingDays: false,
        }),
        otherAllocations: others,
        timeOff: [],
      }).overDays,
    ).toBe(1);
  });

  it('mirrors the over-marker for an ignoreWorkingDays weekend; weekend-aware does not', () => {
    // Fri–Sun: a weekend-aware proposal leaves Sat/Sun uncounted, but opting into weekends flags
    // them: a Mon–Fri person has 0 weekend capacity, so the advisory matches the red over-marker.
    expect(
      capacityAdvisory({
        resource: r,
        proposal: proposal({
          startDate: '2026-06-05',
          endDate: '2026-06-07',
          hoursPerDay: 8,
          ignoreWorkingDays: false,
        }),
        otherAllocations: [],
        timeOff: [],
      }).overDays,
    ).toBe(0);
    expect(
      capacityAdvisory({
        resource: r,
        proposal: proposal({
          startDate: '2026-06-05',
          endDate: '2026-06-07',
          hoursPerDay: 8,
          ignoreWorkingDays: true,
        }),
        otherAllocations: [],
        timeOff: [],
      }).overDays,
    ).toBe(2);
  });

  it('returns the zeroed advisory when the window is empty (start after end)', () => {
    expect(
      capacityAdvisory({
        resource: r,
        proposal: proposal({
          startDate: '2026-06-05',
          endDate: '2026-06-01',
          hoursPerDay: 8,
          ignoreWorkingDays: false,
        }),
        otherAllocations: [],
        timeOff: [],
      }),
    ).toEqual({
      overDays: 0,
      timeOffDays: 0,
    });
  });

  it('returns before expanding a proposed window beyond the shared calendar-span bound', () => {
    const start = '2026-01-01';
    expect(
      capacityAdvisory({
        resource: r,
        proposal: proposal({
          startDate: start,
          endDate: addDaysISO(start, MAX_SPAN_DAYS),
          hoursPerDay: 8,
          ignoreWorkingDays: false,
        }),
        otherAllocations: [],
        timeOff: [],
      }),
    ).toEqual({
      overDays: 0,
      timeOffDays: 0,
    });
  });

  it('clamps an existing allocation to the window start (does not count its hours before start)', () => {
    const others = [
      makeAlloc({
        startDate: '2026-06-03',
        endDate: '2026-06-03',
        hoursPerDay: 4,
      }),
    ];
    const { overDays } = capacityAdvisory({
      resource: r,
      proposal: proposal({
        startDate: '2026-06-01',
        endDate: '2026-06-03',
        hoursPerDay: 5,
        ignoreWorkingDays: false,
      }),
      otherAllocations: others,
      timeOff: [],
    });
    expect(overDays).toBe(1);
  });

  it('clamps an existing allocation to the window end (does not count its hours after it ends)', () => {
    const others = [
      makeAlloc({
        startDate: '2026-06-01',
        endDate: '2026-06-01',
        hoursPerDay: 4,
      }),
    ];
    const { overDays } = capacityAdvisory({
      resource: r,
      proposal: proposal({
        startDate: '2026-06-01',
        endDate: '2026-06-03',
        hoursPerDay: 5,
        ignoreWorkingDays: false,
      }),
      otherAllocations: others,
      timeOff: [],
    });
    expect(overDays).toBe(1);
  });

  it('ignores allocations belonging to another resource (callers need not pre-filter)', () => {
    // The advisory's per-day mirror (allocatedHoursOnDay) scopes by resource; this must too, so a
    // caller handing over an unfiltered list cannot have someone else's 8h read as this person's.
    const others = [
      makeAlloc({ id: 'someone-else', resourceId: 'r2', hoursPerDay: 8 }),
      makeAlloc({ id: 'ours', hoursPerDay: 4 }),
    ];
    const { overDays } = capacityAdvisory({
      resource: r,
      proposal: proposal({
        startDate: '2026-06-01',
        endDate: '2026-06-05',
        hoursPerDay: 4,
        ignoreWorkingDays: false,
      }),
      otherAllocations: others,
      timeOff: [],
    });
    expect(overDays).toBe(0);
  });

  it('reads a blocks-mode projection of legacy hourly allocations as zero load', () => {
    const legacy = [makeAlloc({ hoursPerDay: 8 })];
    expect(
      capacityAdvisory({
        resource: r,
        proposal: proposal({
          startDate: '2026-06-01',
          endDate: '2026-06-05',
          hoursPerDay: 0,
          ignoreWorkingDays: false,
        }),
        otherAllocations: legacy,
        timeOff: [],
      }).overDays,
    ).toBe(0);

    expect(
      capacityAdvisory({
        resource: r,
        proposal: proposal({
          startDate: '2026-06-01',
          endDate: '2026-06-05',
          hoursPerDay: 1,
          ignoreWorkingDays: false,
        }),
        otherAllocations: legacy,
        timeOff: [],
      }).overDays,
    ).toBe(5);
    const projected = applyCapacityMode({ allocations: legacy, blocksMode: true });
    expect(
      capacityAdvisory({
        resource: r,
        proposal: proposal({
          startDate: '2026-06-01',
          endDate: '2026-06-05',
          hoursPerDay: 1,
          ignoreWorkingDays: false,
        }),
        otherAllocations: projected,
        timeOff: [],
      }).overDays,
    ).toBe(0);
  });

  it('does not count an existing weekend-aware allocation on a weekend day it merely spans', () => {
    // The other allocation spans Fri-Mon but (weekend-aware, no ignoreWorkingDays) does no work on
    // Sat. The proposal opts into the weekend via ignoreWorkingDays with 0 hours, so a spurious
    // carry-over of the other allocation's hours onto Sat would wrongly flag it as over.
    const others = [
      makeAlloc({
        startDate: '2026-06-05',
        endDate: '2026-06-08',
        hoursPerDay: 8,
      }),
    ];
    const { overDays } = capacityAdvisory({
      resource: r,
      proposal: proposal({
        startDate: '2026-06-06',
        endDate: '2026-06-06',
        hoursPerDay: 0,
        ignoreWorkingDays: true,
      }),
      otherAllocations: others,
      timeOff: [],
    });
    expect(overDays).toBe(0);
  });
});
