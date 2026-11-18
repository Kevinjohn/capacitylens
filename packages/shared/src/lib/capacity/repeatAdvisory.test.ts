import { describe, expect, it } from 'vitest';
import { NULLABLE_FIELDS } from '../../types/nullableFields.js';
import type { Allocation, Closure, Resource, TimeOff, Weekday } from '../../types/entities.js';
import { effectiveWorkingWeek } from '../effectiveWorkingWeek.js';
import { generateRepeatingStartDates } from '../repeatingDates.js';
import { buildRepeatedAllocationDrafts } from '../repeatingOccurrences.js';
import type { RepeatProjectionContext } from '../repeatingOccurrences.js';
import { buildRepeatingAllocationAdvisory as repeatingAllocationAdvisoryWithWeek } from './repeatAdvisory.js';

type AllocationDraft = Pick<
  Allocation,
  'resourceId' | 'activityId' | 'startDate' | 'endDate' | 'hoursPerDay' | 'status'
> &
  Partial<Pick<Allocation, 'note' | 'ignoreWorkingDays'>>;

interface RepeatContextTestInput {
  schedulingMode: RepeatProjectionContext['schedulingMode'];
  daysOver: number;
  resource?: ReturnType<typeof resourceContext> | undefined;
  accountWorkingDays?: Weekday[] | undefined;
}

interface RepeatingAllocationAdvisoryTestInput {
  resource: Resource;
  existingLoad: readonly AllocationDraft[];
  timeOff: TimeOff[];
  proposedDrafts: readonly AllocationDraft[];
  closures: Closure[];
}

const baseDraft = (overrides: Partial<AllocationDraft> = {}): AllocationDraft => ({
  resourceId: 'r1',
  activityId: 'activity',
  startDate: '2027-01-31',
  endDate: '2027-02-02',
  hoursPerDay: 8,
  status: 'confirmed',
  note: 'Keep me',
  ignoreWorkingDays: false,
  ...overrides,
});

type TestRepeatResource = RepeatProjectionContext['resource'] & { workingDays: Weekday[] };

const resourceContext = (overrides: Partial<TestRepeatResource> = {}): TestRepeatResource => ({
  id: 'r1',
  kind: 'person',
  workingDays: [1, 2, 3, 4, 5],
  ...overrides,
});

const repeatContext = ({
  schedulingMode,
  daysOver,
  resource = resourceContext(),
  accountWorkingDays = [1, 2, 3, 4, 5],
}: RepeatContextTestInput): RepeatProjectionContext => ({
  schedulingMode,
  daysOver,
  resource,
  effectiveWeek: effectiveWorkingWeek(resource, accountWorkingDays),
});

const fullResource = (
  overrides: Partial<Resource> = { ...NULLABLE_FIELDS.resources },
): Resource => ({
  ...NULLABLE_FIELDS.resources,
  id: 'r1',
  companyId: 'a1',
  createdAt: 't',
  updatedAt: 't',
  kind: 'person',
  name: 'Person',
  role: 'Designer',
  employmentType: 'permanent',
  engagement: 'studio' as const,
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  halfDays: [],
  color: '#111111',
  ...overrides,
});

const repeatingAllocationAdvisory = ({
  resource,
  existingLoad,
  timeOff,
  proposedDrafts,
  closures,
}: RepeatingAllocationAdvisoryTestInput) =>
  repeatingAllocationAdvisoryWithWeek({
    resource,
    existingLoad,
    timeOff,
    proposedDrafts,
    effectiveWeek: effectiveWorkingWeek(resource, [1, 2, 3, 4, 5]),
    closures,
  });

describe('repeatingAllocationAdvisory', () => {
  it('accepts transient drafts and counts existing-load plus internal generated conflicts', () => {
    const drafts = [
      baseDraft({ startDate: '2026-06-01', endDate: '2026-06-10', hoursPerDay: 5 }),
      baseDraft({ startDate: '2026-06-08', endDate: '2026-06-12', hoursPerDay: 5 }),
    ];
    const existing: AllocationDraft[] = [
      baseDraft({ startDate: '2026-06-01', endDate: '2026-06-01', hoursPerDay: 4 }),
    ];
    expect(
      repeatingAllocationAdvisory({
        resource: fullResource(),
        existingLoad: existing,
        timeOff: [],
        proposedDrafts: drafts,
        closures: [],
      }),
    ).toEqual({
      overCapacityAllocations: 2,
      timeOffAllocations: 0,
      nonEffectiveStartAllocations: 0,
    });
  });

  it('attributes existing load to the drafts whose window it actually covers', () => {
    // The batch shares one day→hours bucket across every draft, so existing load has to stay
    // pinned to its own dates: an allocation sitting only in the last draft's week must not make
    // the first draft read as over, and vice versa.
    const drafts = [
      baseDraft({ startDate: '2026-06-01', endDate: '2026-06-01', hoursPerDay: 5 }),
      baseDraft({ startDate: '2026-06-15', endDate: '2026-06-15', hoursPerDay: 5 }),
    ];
    const lateOnly: AllocationDraft[] = [
      baseDraft({ startDate: '2026-06-15', endDate: '2026-06-15', hoursPerDay: 4 }),
    ];
    expect(
      repeatingAllocationAdvisory({
        resource: fullResource(),
        existingLoad: lateOnly,
        timeOff: [],
        proposedDrafts: drafts,
        closures: [],
      }),
    ).toEqual({
      overCapacityAllocations: 1,
      timeOffAllocations: 0,
      nonEffectiveStartAllocations: 0,
    });

    expect(
      repeatingAllocationAdvisory({
        resource: fullResource(),
        existingLoad: lateOnly,
        timeOff: [],
        proposedDrafts: drafts.slice(0, 1),
        closures: [],
      }),
    ).toEqual({
      overCapacityAllocations: 0,
      timeOffAllocations: 0,
      nonEffectiveStartAllocations: 0,
    });
  });
});

describe('repeatingAllocationAdvisory load accounting', () => {
  it('does not double-count existing load across the drafts of one batch', () => {
    // Each draft is advised against the existing load once (plus the drafts before it). A bucket
    // that re-added the same allocation per draft would push the later occurrences over.
    const drafts = [
      baseDraft({ startDate: '2026-06-01', endDate: '2026-06-01', hoursPerDay: 4 }),
      baseDraft({ startDate: '2026-06-02', endDate: '2026-06-02', hoursPerDay: 4 }),
      baseDraft({ startDate: '2026-06-03', endDate: '2026-06-03', hoursPerDay: 4 }),
    ];
    const existing: AllocationDraft[] = [
      baseDraft({ startDate: '2026-06-01', endDate: '2026-06-05', hoursPerDay: 4 }),
    ];
    expect(
      repeatingAllocationAdvisory({
        resource: fullResource(),
        existingLoad: existing,
        timeOff: [],
        proposedDrafts: drafts,
        closures: [],
      }),
    ).toEqual({
      overCapacityAllocations: 0,
      timeOffAllocations: 0,
      nonEffectiveStartAllocations: 0,
    });
  });

  it('counts allocations overlapping time off once and keeps categories independent', () => {
    const timeOff: TimeOff[] = [
      {
        id: 'to1',
        companyId: 'a1',
        createdAt: 't',
        updatedAt: 't',
        resourceId: 'r1',
        startDate: '2026-06-02',
        endDate: '2026-06-09',
        type: 'holiday',
        note: null,
      },
    ];
    const drafts = [
      baseDraft({ startDate: '2026-06-01', endDate: '2026-06-03', hoursPerDay: 8 }),
      baseDraft({ startDate: '2026-06-08', endDate: '2026-06-10', hoursPerDay: 8 }),
    ];
    expect(
      repeatingAllocationAdvisory({
        resource: fullResource(),
        existingLoad: [],
        timeOff,
        proposedDrafts: drafts,
        closures: [],
      }),
    ).toEqual({
      overCapacityAllocations: 0,
      timeOffAllocations: 2,
      nonEffectiveStartAllocations: 0,
    });
  });
});

describe('repeatingAllocationAdvisory schedule exceptions', () => {
  it('creates later occurrences on company closures and counts them in the overlap advisory', () => {
    const drafts = buildRepeatedAllocationDrafts(
      baseDraft({ startDate: '2026-06-01', endDate: '2026-06-01' }),
      ['2026-06-01', '2026-06-08', '2026-06-15'],
      repeatContext({ schedulingMode: 'hourly', daysOver: 1 }),
    );
    const companyClosure: Closure[] = [
      {
        id: 'company-closure',
        companyId: 'a1',
        createdAt: 't',
        updatedAt: 't',
        name: 'Company shutdown',
        startDate: '2026-06-08',
        endDate: '2026-06-08',
      },
    ];

    expect(drafts.map((draft) => draft.startDate)).toEqual([
      '2026-06-01',
      '2026-06-08',
      '2026-06-15',
    ]);
    expect(
      repeatingAllocationAdvisory({
        resource: fullResource(),
        existingLoad: [],
        timeOff: [],
        proposedDrafts: drafts,
        closures: companyClosure,
      }),
    ).toEqual({
      overCapacityAllocations: 0,
      timeOffAllocations: 1,
      nonEffectiveStartAllocations: 0,
    });
  });
});

describe('repeatingAllocationAdvisory half-day capacity', () => {
  it('uses the fixed four-hour half-day boundary for every repeated occurrence', () => {
    const resource = fullResource({ halfDays: [2] });
    const exactCapacity = baseDraft({
      startDate: '2026-06-02',
      endDate: '2026-06-02',
      hoursPerDay: 4,
    });
    const overCapacity = baseDraft({
      startDate: '2026-06-09',
      endDate: '2026-06-09',
      hoursPerDay: 5,
    });

    expect(
      repeatingAllocationAdvisory({
        resource,
        existingLoad: [],
        timeOff: [],
        proposedDrafts: [exactCapacity],
        closures: [],
      }),
    ).toEqual({
      overCapacityAllocations: 0,
      timeOffAllocations: 0,
      nonEffectiveStartAllocations: 0,
    });
    expect(
      repeatingAllocationAdvisory({
        resource,
        existingLoad: [],
        timeOff: [],
        proposedDrafts: [overCapacity],
        closures: [],
      }),
    ).toEqual({
      overCapacityAllocations: 1,
      timeOffAllocations: 0,
      nonEffectiveStartAllocations: 0,
    });
  });
});

describe('repeatingAllocationAdvisory zero-load and external resources', () => {
  it('keeps zero-load Blocks clean on half days and skips External resources', () => {
    const zeroDraft = baseDraft({ hoursPerDay: 0 });
    expect(
      repeatingAllocationAdvisory({
        resource: fullResource({ halfDays: [1] }),
        existingLoad: [],
        timeOff: [],
        proposedDrafts: [zeroDraft],
        closures: [],
      }),
    ).toEqual({
      overCapacityAllocations: 0,
      timeOffAllocations: 0,
      nonEffectiveStartAllocations: 1,
    });
    expect(
      repeatingAllocationAdvisory({
        resource: fullResource({ kind: 'external' }),
        existingLoad: [],
        timeOff: [],
        proposedDrafts: [zeroDraft],
        closures: [],
      }),
    ).toEqual({
      overCapacityAllocations: 0,
      timeOffAllocations: 0,
      nonEffectiveStartAllocations: 0,
    });
  });

  it('counts monthly starts outside the effective week, including draft 0, but excludes ignored occurrences', () => {
    const resource = fullResource({ workingDays: [1] });
    const drafts = [
      baseDraft({ startDate: '2026-06-01', endDate: '2026-06-01' }),
      baseDraft({ startDate: '2026-07-01', endDate: '2026-07-06' }),
      baseDraft({ startDate: '2026-08-01', endDate: '2026-08-03' }),
      baseDraft({ startDate: '2026-09-01', endDate: '2026-09-01', ignoreWorkingDays: true }),
    ];

    expect(
      repeatingAllocationAdvisory({
        resource,
        existingLoad: [],
        timeOff: [],
        proposedDrafts: drafts,
        closures: [],
      }),
    ).toMatchObject({
      nonEffectiveStartAllocations: 2,
    });
  });
});

describe('repeatingAllocationAdvisory effective starts', () => {
  it('reports zero non-effective starts for a weekly cadence anchored on an effective weekday', () => {
    const resource = fullResource({ workingDays: [1] });
    const starts = generateRepeatingStartDates('2026-06-01', '2026-06-29', {
      kind: 'weeks',
      interval: 1,
    }).startDates;
    const drafts = starts.map((startDate) => baseDraft({ startDate, endDate: startDate }));

    expect(
      repeatingAllocationAdvisory({
        resource,
        existingLoad: [],
        timeOff: [],
        proposedDrafts: drafts,
        closures: [],
      }),
    ).toMatchObject({
      nonEffectiveStartAllocations: 0,
    });
  });
});
