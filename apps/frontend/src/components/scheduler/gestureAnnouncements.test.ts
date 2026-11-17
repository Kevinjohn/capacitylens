import { describe, expect, it } from 'vitest';
import type { Allocation, ISODate, Resource } from '@capacitylens/shared/types/entities';
import { m } from '@/i18n';
import { formatCapacityAdvisory } from '@/lib/capacity/advisoryCopy';
import {
  DEFAULT_ACCOUNT_ID,
  makeActivity,
  makeAllocation,
  makeAppData,
  makeBar,
  makeResource,
  WORKDAYS,
} from '@/test/fixtures';
import { capacityOver } from '@/test/capacityFixtures';
import type { ResourceFigures } from '@/test/capacityFixtures';
import type { CapacitySection } from '@capacitylens/shared/lib/capacity';
import { buildCapacityAnnouncement, buildCapacityGestureAdvisory } from './gestureAnnouncements';
import type { GestureCapacitySource } from './gestureAnnouncements';

// Both builders are pure. The announcement reads server-shaped figures; the advisory reads
// resources and allocations. Each case compares the resulting strings with the compiled messages.

const A = DEFAULT_ACCOUNT_ID;
const NAME = 'Diana Prince';
const clear = m.scheduler_sr_announce_clear({ name: NAME });
const overOne = m.scheduler_sr_announce_over_one({ name: NAME, count: 1 });
const over = (count: number) => m.scheduler_sr_announce_over_other({ name: NAME, count });

const person = (id: string, overrides: Partial<Resource> = {}): Resource =>
  makeResource({ id, accountId: A, name: NAME, ...overrides });
const alloc = (
  id: string,
  resourceId: string,
  startDate: ISODate,
  endDate: ISODate,
  hoursPerDay = 8,
): Allocation =>
  makeAllocation({
    id,
    accountId: A,
    resourceId,
    activityId: 't1',
    startDate,
    endDate,
    hoursPerDay,
  });

let source: GestureCapacitySource;

function seed(resources: Resource[], allocations: Allocation[]): void {
  source = {
    data: makeAppData({
      activities: [makeActivity({ id: 't1', accountId: A, kind: 'repeatable', projectId: null })],
      resources,
      allocations,
    }),
    accountWorkingDays: WORKDAYS,
  };
}

// Anchor the visible window to fixed fixture dates so the clamp is deterministic.
const VISIBLE = { start: '2026-06-01', end: '2026-06-14' };
const announce = (resourceId: string, capacity: CapacitySection | null) =>
  buildCapacityAnnouncement({
    resources: source.data.resources,
    capacity,
    resourceId,
    visibleRange: VISIBLE,
  });
const figures = (
  resources: Record<string, ResourceFigures>,
  from = '2026-05-25',
  to = '2026-06-21',
) => capacityOver({ from, to }, resources);
const overOn = (...dates: string[]) => ({
  byDate: Object.fromEntries(dates.map((date) => [date, { allocated: 16, over: true }])),
});
const advise = (input: Omit<Parameters<typeof buildCapacityGestureAdvisory>[0], 'source'>) =>
  buildCapacityGestureAdvisory({ ...input, source });

describe('buildCapacityAnnouncement', () => {
  it('is silent for an unknown or untracked resource', () => {
    seed([person('r1'), person('ext', { kind: 'external' })], []);
    const capacity = figures({ ext: overOn('2026-06-02') });
    expect(announce('missing', capacity)).toBe('');
    expect(announce('ext', capacity)).toBe('');
  });

  it('reports no conflicts when the server sends no over day or no figures', () => {
    seed([person('r1')], []);
    expect(announce('r1', figures({ r1: { fill: { allocated: 8 } } }))).toBe(clear);
    expect(announce('r1', figures({}))).toBe(clear);
    expect(announce('r1', null)).toBe(clear);
  });

  it('counts only the named resource and picks singular or plural wording', () => {
    seed([person('r1'), person('r2')], []);
    const capacity = figures({
      r1: overOn('2026-06-02'),
      r2: overOn('2026-06-03', '2026-06-04'),
    });
    expect(announce('r1', capacity)).toBe(overOne);
    expect(announce('r1', figures({ r1: overOn('2026-06-02', '2026-06-03') }))).toBe(over(2));
  });

  it('clamps the counted days to the visible window on both sides', () => {
    seed([person('r1')], []);
    const capacity = figures({
      r1: overOn('2026-05-31', '2026-06-01', '2026-06-14', '2026-06-15'),
    });
    expect(announce('r1', capacity)).toBe(over(2));
  });

  it('counts a visible date the server has not sent as not over', () => {
    seed([person('r1')], []);
    const capacity = figures({ r1: overOn('2026-06-08') }, '2026-06-08', '2026-06-08');
    expect(announce('r1', capacity)).toBe(overOne);
  });
});

describe('buildCapacityGestureAdvisory', () => {
  const dates = { startDate: '2026-06-01', endDate: '2026-06-02' } as const;
  const overTwo = formatCapacityAdvisory({ overDays: 2, timeOffDays: 0 }, 'toast');
  const own = alloc('own', 'r1', '2026-06-01', '2026-06-02');

  it('is silent for an unknown or untracked resource', () => {
    seed(
      [person('r1'), person('ext', { kind: 'external' })],
      [
        alloc('other', 'r1', '2026-06-01', '2026-06-02'),
        alloc('a', 'ext', '2026-06-01', '2026-06-02'),
      ],
    );
    const input = { bar: makeBar({ allocation: own }), isBlocks: false, dates, reconciledHours: 9 };
    expect(advise({ ...input, effectiveResourceId: 'missing' })).toBe('');
    expect(advise({ ...input, effectiveResourceId: 'ext' })).toBe('');
  });

  it('excludes the gestured bar’s own allocation from the existing load', () => {
    seed([person('r1')], [own]);
    const input = { effectiveResourceId: 'r1', isBlocks: false, dates, reconciledHours: 8 };
    expect(advise({ ...input, bar: makeBar({ allocation: own }) })).toBe('');
    expect(
      advise({
        ...input,
        bar: makeBar({ allocation: { ...own, id: 'another' } }),
      }),
    ).toBe(overTwo);
    expect(overTwo).not.toBe('');
  });

  it('projects blocks-mode load instead of the reconciled hours', () => {
    seed([person('r1')], [own]);
    const input = {
      bar: makeBar({ allocation: { ...own, id: 'another' } }),
      effectiveResourceId: 'r1',
      dates,
      reconciledHours: 2,
    };
    expect(advise({ ...input, isBlocks: false })).toBe(overTwo);
    expect(advise({ ...input, isBlocks: true })).toBe('');
  });
});
