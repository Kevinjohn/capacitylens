import { beforeEach, describe, expect, it } from 'vitest';
import type { Allocation, ISODate, Resource } from '@capacitylens/shared/types/entities';
import { m } from '@/i18n';
import { formatCapacityAdvisory } from '@/lib/capacity';
import { useStore } from '@/store/useStore';
import {
  DEFAULT_ACCOUNT_ID,
  makeActivity,
  makeAllocation,
  makeBar,
  makeResource,
  resetStoreWithAccount,
} from '@/test/fixtures';
import { readCapacityAnnouncement, readCapacityGestureAdvisory } from './gestureAnnouncements';

// Both readers pull from the live store, so the window, the resource set and the allocations are
// seeded directly into state and the resulting strings compared with the compiled messages.

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
  makeAllocation({ id, accountId: A, resourceId, activityId: 't1', startDate, endDate, hoursPerDay });

function seed(resources: Resource[], allocations: Allocation[]): void {
  useStore.setState((state) => ({
    // Anchor the visible window to fixed fixture dates so the clamp is deterministic.
    ui: { ...state.ui, originDate: '2026-06-01', rangeDays: 14 },
    data: {
      ...state.data,
      activities: [makeActivity({ id: 't1', accountId: A, kind: 'repeatable', projectId: null })],
      resources,
      allocations,
    },
  }));
}

beforeEach(() => resetStoreWithAccount());

describe('readCapacityAnnouncement', () => {
  it('is silent for an unknown or untracked resource', () => {
    seed([person('r1'), person('ext', { kind: 'external' })], [alloc('a', 'ext', '2026-06-01', '2026-06-02')]);
    expect(readCapacityAnnouncement('missing')).toBe('');
    expect(readCapacityAnnouncement('ext')).toBe('');
  });

  it('reports no conflicts without allocations or when load stays within capacity', () => {
    seed([person('r1')], []);
    expect(readCapacityAnnouncement('r1')).toBe(clear);
    seed([person('r1')], [alloc('a', 'r1', '2026-06-01', '2026-06-02')]);
    expect(readCapacityAnnouncement('r1')).toBe(clear);
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
    expect(readCapacityAnnouncement('r1')).toBe(overOne);
    seed([person('r1')], [alloc('a', 'r1', '2026-06-01', '2026-06-03'), alloc('b', 'r1', '2026-06-02', '2026-06-03')]);
    expect(readCapacityAnnouncement('r1')).toBe(over(2));
  });

  it('spans from the earliest start to the latest end regardless of allocation order', () => {
    seed(
      [person('r1')],
      [
        alloc('late', 'r1', '2026-06-08', '2026-06-09'),
        alloc('a', 'r1', '2026-06-02', '2026-06-03'),
        alloc('b', 'r1', '2026-06-02', '2026-06-03'),
      ],
    );
    expect(readCapacityAnnouncement('r1')).toBe(over(2));
  });

  it('clamps the counted days to the visible window on both sides', () => {
    seed([person('r1')], [alloc('a', 'r1', '2026-05-25', '2026-06-05'), alloc('b', 'r1', '2026-05-25', '2026-06-05')]);
    expect(readCapacityAnnouncement('r1')).toBe(over(5));
    seed([person('r1')], [alloc('a', 'r1', '2026-06-10', '2026-06-19'), alloc('b', 'r1', '2026-06-10', '2026-06-19')]);
    expect(readCapacityAnnouncement('r1')).toBe(over(3));
    seed([person('r1')], [alloc('a', 'r1', '2026-06-22', '2026-06-23'), alloc('b', 'r1', '2026-06-22', '2026-06-23')]);
    expect(readCapacityAnnouncement('r1')).toBe(clear);
  });
});

describe('readCapacityGestureAdvisory', () => {
  const dates = { startDate: '2026-06-01', endDate: '2026-06-02' } as const;
  const overTwo = formatCapacityAdvisory({ overDays: 2, timeOffDays: 0 }, 'toast');
  const own = alloc('own', 'r1', '2026-06-01', '2026-06-02');

  it('is silent for an unknown or untracked resource', () => {
    seed([person('ext', { kind: 'external' })], [alloc('a', 'ext', '2026-06-01', '2026-06-02')]);
    const input = { bar: makeBar({ allocation: own }), isBlocks: false, dates, reconciledHours: 8 };
    expect(readCapacityGestureAdvisory({ ...input, effectiveResourceId: 'missing' })).toBe('');
    expect(readCapacityGestureAdvisory({ ...input, effectiveResourceId: 'ext' })).toBe('');
  });

  it('excludes the gestured bar’s own allocation from the existing load', () => {
    seed([person('r1')], [own]);
    const input = { effectiveResourceId: 'r1', isBlocks: false, dates, reconciledHours: 8 };
    expect(readCapacityGestureAdvisory({ ...input, bar: makeBar({ allocation: own }) })).toBe('');
    expect(
      readCapacityGestureAdvisory({
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
    expect(readCapacityGestureAdvisory({ ...input, isBlocks: false })).toBe(overTwo);
    expect(readCapacityGestureAdvisory({ ...input, isBlocks: true })).toBe('');
  });
});
