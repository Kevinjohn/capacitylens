import { describe, expect, it } from 'vitest';
import type { Resource } from '@capacitylens/shared/types/entities';
import { m } from '@/i18n';
import { DEFAULT_ACCOUNT_ID, makeResource } from '@/test/fixtures';
import { capacityOver } from '@/test/capacityFixtures';
import type { ResourceFigures } from '@/test/capacityFixtures';
import type { CapacitySection } from '@capacitylens/shared/lib/capacity';
import { buildCapacityAnnouncement } from './gestureAnnouncements';

// The builder is pure: each case passes server-shaped figures and compares the resulting string
// with the compiled messages.

const A = DEFAULT_ACCOUNT_ID;
const NAME = 'Diana Prince';
const clear = m.scheduler_sr_announce_clear({ name: NAME });
const overOne = m.scheduler_sr_announce_over_one({ name: NAME, count: 1 });
const over = (count: number) => m.scheduler_sr_announce_over_other({ name: NAME, count });

const person = (id: string, overrides: Partial<Resource> = {}): Resource =>
  makeResource({ id, companyId: A, name: NAME, ...overrides });
let seeded: Resource[] = [];

function seed(rows: Resource[]): void {
  seeded = rows;
}

// Anchor the visible window to fixed fixture dates so the clamp is deterministic.
const VISIBLE = { start: '2026-06-01', end: '2026-06-14' };
const announce = (resourceId: string, capacity: CapacitySection | null) =>
  buildCapacityAnnouncement({
    resources: seeded,
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

describe('buildCapacityAnnouncement', () => {
  it('is silent for an unknown or untracked resource', () => {
    seed([person('r1'), person('ext', { kind: 'external' })]);
    const capacity = figures({ ext: overOn('2026-06-02') });
    expect(announce('missing', capacity)).toBe('');
    expect(announce('ext', capacity)).toBe('');
  });

  it('reports no conflicts when the server sends no over day or no figures', () => {
    seed([person('r1')]);
    expect(announce('r1', figures({ r1: { fill: { allocated: 8 } } }))).toBe(clear);
    expect(announce('r1', figures({}))).toBe(clear);
    expect(announce('r1', null)).toBe(clear);
  });

  it('counts only the named resource and picks singular or plural wording', () => {
    seed([person('r1'), person('r2')]);
    const capacity = figures({
      r1: overOn('2026-06-02'),
      r2: overOn('2026-06-03', '2026-06-04'),
    });
    expect(announce('r1', capacity)).toBe(overOne);
    expect(announce('r1', figures({ r1: overOn('2026-06-02', '2026-06-03') }))).toBe(over(2));
  });

  it('clamps the counted days to the visible window on both sides', () => {
    seed([person('r1')]);
    const capacity = figures({
      r1: overOn('2026-05-31', '2026-06-01', '2026-06-14', '2026-06-15'),
    });
    expect(announce('r1', capacity)).toBe(over(2));
  });

  it('counts a visible date the server has not sent as not over', () => {
    seed([person('r1')]);
    const capacity = figures({ r1: overOn('2026-06-08') }, '2026-06-08', '2026-06-08');
    expect(announce('r1', capacity)).toBe(overOne);
  });
});
