import { describe, expect, it } from 'vitest';
import type { Allocation, ISODate, Resource } from '@capacitylens/shared/types/entities';
import { m } from '@/i18n';
import { formatCapacityAdvisory } from '@/lib/capacity';
import {
  DEFAULT_ACCOUNT_ID,
  makeActivity,
  makeAllocation,
  makeAppData,
  makeBar,
  makeResource,
  WORKDAYS,
} from '@/test/fixtures';
import { buildCapacityAnnouncement, buildCapacityGestureAdvisory } from './gestureAnnouncements';
import type { GestureCapacitySource } from './gestureAnnouncements';

// Both builders are pure, so each case passes its resources and allocations as the capacity source
// and compares the resulting strings with the compiled messages.

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
const announce = (resourceId: string) =>
  buildCapacityAnnouncement({
    source,
    resourceId,
    visibleRange: { start: '2026-06-01', end: '2026-06-14' },
    blocksMode: false,
  });
const advise = (input: Omit<Parameters<typeof buildCapacityGestureAdvisory>[0], 'source'>) =>
  buildCapacityGestureAdvisory({ ...input, source });

describe('buildCapacityAnnouncement', () => {
  it('is silent for an unknown or untracked resource', () => {
    seed(
      [person('r1'), person('ext', { kind: 'external' })],
      [alloc('a', 'ext', '2026-06-01', '2026-06-02')],
    );
    expect(announce('missing')).toBe('');
    expect(announce('ext')).toBe('');
  });

  it('reports no conflicts without allocations or when load stays within capacity', () => {
    seed([person('r1')], []);
    expect(announce('r1')).toBe(clear);
    seed([person('r1')], [alloc('a', 'r1', '2026-06-01', '2026-06-02')]);
    expect(announce('r1')).toBe(clear);
  });

  it('counts only the named resource and picks singular or plural wording', () => {
    seed(
      [person('r1'), person('r2')],
      [
        alloc('a', 'r1', '2026-06-01', '2026-06-02'),
        alloc('b', 'r1', '2026-06-02', '2026-06-02'),
        alloc('c', 'r2', '2026-06-03', '2026-06-04'),
        alloc('d', 'r2', '2026-06-03', '2026-06-04'),
      ],
    );
    expect(announce('r1')).toBe(overOne);
    seed(
      [person('r1')],
      [alloc('a', 'r1', '2026-06-01', '2026-06-03'), alloc('b', 'r1', '2026-06-02', '2026-06-03')],
    );
    expect(announce('r1')).toBe(over(2));
  });

  it('spans from the earliest start to the latest end regardless of allocation order', () => {
    seed(
      [person('r1')],
      [
        alloc('mid', 'r1', '2026-06-04', '2026-06-05', 4),
        alloc('a', 'r1', '2026-06-02', '2026-06-02'),
        alloc('a2', 'r1', '2026-06-02', '2026-06-02'),
        alloc('late', 'r1', '2026-06-08', '2026-06-09'),
        alloc('late2', 'r1', '2026-06-08', '2026-06-09'),
        alloc('mid2', 'r1', '2026-06-04', '2026-06-05', 4),
      ],
    );
    expect(announce('r1')).toBe(over(3));
  });

  it('clamps the counted days to the visible window on both sides', () => {
    seed(
      [person('r1')],
      [alloc('a', 'r1', '2026-05-25', '2026-06-05'), alloc('b', 'r1', '2026-05-25', '2026-06-05')],
    );
    expect(announce('r1')).toBe(over(5));
    seed(
      [person('r1')],
      [alloc('a', 'r1', '2026-06-10', '2026-06-19'), alloc('b', 'r1', '2026-06-10', '2026-06-19')],
    );
    expect(announce('r1')).toBe(over(3));
    seed(
      [person('r1')],
      [alloc('a', 'r1', '2026-06-22', '2026-06-23'), alloc('b', 'r1', '2026-06-22', '2026-06-23')],
    );
    expect(announce('r1')).toBe(clear);
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
