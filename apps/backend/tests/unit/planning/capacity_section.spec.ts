import { test } from '@japa/runner';
import { buildActiveData } from '@capacitylens/shared/domain/lifecycle';
import { buildCapacityWindow } from '@capacitylens/shared/lib/capacity';
import type { CapacityDays } from '@capacitylens/shared/lib/capacity';
import { normalizeCompanyWorkingDays } from '@capacitylens/shared/lib/companyWorkingDays';
import { resolveEffectiveWorkingWeek } from '@capacitylens/shared/lib/effectiveWorkingWeek';
import { isCapacityTracked } from '@capacitylens/shared/types/entities';
import type { Allocation, Weekday } from '@capacitylens/shared/types/entities';
import { buildCapacitySection } from '#services/planning/capacity_section';
import { readState } from '#tests/helpers/state_fixture';
import { freshDatabase } from '#tests/helpers/fresh_database';
import { resetPlanningFixture } from '#tests/functional/planning/helpers';

// Each Scheduling-invariants rule (DECISIONS.md) is one case against the read's capacity section.
// 2026-06-01 is a Monday.
import {
  allocation,
  closure,
  companyRow,
  data,
  resource,
  section,
  timeOff,
} from '#tests/helpers/unit/capacity_section';

test.group('capacity section', () => {
  test('a day is over only when allocated hours are strictly greater than available', ({
    assert,
  }) => {
    const { window } = section({
      allocations: [
        allocation({ startDate: '2026-06-01', hoursPerDay: 8 }),
        allocation({ startDate: '2026-06-02', hoursPerDay: 8.5 }),
        // Five 1.6 h bookings fill an 8 h day exactly, whatever the summation order.
        ...Array.from({ length: 5 }, () =>
          allocation({ startDate: '2026-06-03', hoursPerDay: 1.6 })
        ),
      ],
    }).resources['r-diana']!;
    assert.deepEqual(window.allocated.slice(0, 2), [8, 8.5]);
    assert.deepEqual(window.available.slice(0, 3), [8, 8, 8]);
    assert.deepEqual(window.over.slice(0, 3), [false, true, false]);
  });

  test('the effective week is the company set intersected with the person; placeholders use the company set', ({
    assert,
  }) => {
    const { resources } = section(
      {
        resources: [
          resource('r-diana', { workingDays: [2, 3, 4, 5] }),
          resource('r-slot', { kind: 'placeholder', workingDays: [2, 3, 4, 5] }),
          resource('r-oracle', { kind: 'external' }),
        ],
        allocations: [
          allocation({ startDate: '2026-06-01', endDate: '2026-06-05' }),
          allocation({ resourceId: 'r-slot', startDate: '2026-06-01', endDate: '2026-06-05' }),
        ],
      },
      { company: companyRow({ workingDays: [1, 2, 3, 4] }) }
    );
    const person = resources['r-diana']!.window;
    assert.deepEqual(person.available.slice(0, 5), [0, 8, 8, 8, 0]);
    assert.deepEqual(person.allocated.slice(0, 5), [0, 4, 4, 4, 0]);
    const placeholder = resources['r-slot']!.window;
    assert.deepEqual(placeholder.available.slice(0, 5), [8, 8, 8, 8, 0]);
    assert.deepEqual(placeholder.allocated.slice(0, 5), [4, 4, 4, 4, 0]);
    // External parties have no capacity, so the section carries none for them.
    assert.notProperty(resources, 'r-oracle');
  });

  test('non-working days consume nothing unless Ignore working days is on, which still respects time off', ({
    assert,
  }) => {
    const normal = section({
      allocations: [allocation({ startDate: '2026-06-06', endDate: '2026-06-07' })],
    }).resources['r-diana']!.window;
    assert.deepEqual(normal.allocated.slice(5, 7), [0, 0]);
    assert.deepEqual(normal.over.slice(5, 7), [false, false]);

    const ignored = section({
      allocations: [
        allocation({ startDate: '2026-06-06', endDate: '2026-06-08', ignoreWorkingDays: true }),
      ],
      timeOff: [timeOff('2026-06-08', '2026-06-08')],
    }).resources['r-diana']!.window;
    assert.deepEqual(ignored.allocated.slice(5, 8), [4, 4, 4]);
    assert.deepEqual(ignored.available.slice(5, 8), [0, 0, 0]);
    assert.deepEqual(ignored.over.slice(5, 8), [true, true, true]);
  });

  test('a closure is a literal span for everyone and may overlap time off', ({ assert }) => {
    const { resources } = section({
      resources: [resource('r-diana'), resource('r-slot', { kind: 'placeholder' })],
      closures: [closure('2026-06-05', '2026-06-08')],
      timeOff: [timeOff('2026-06-08', '2026-06-09')],
    });
    // Friday 5 June to Tuesday 9 June, then Wednesday 10 June.
    assert.deepEqual(resources['r-diana']!.window.available.slice(4, 10), [0, 0, 0, 0, 0, 8]);
    assert.deepEqual(resources['r-slot']!.window.available.slice(4, 10), [0, 0, 0, 0, 8, 8]);
  });

  test('time off clashes with an over day, or in Blocks mode with any booking', ({ assert }) => {
    const rows = {
      // Monday and Tuesday off, Thursday a closure.
      timeOff: [timeOff('2026-06-01', '2026-06-02')],
      closures: [closure('2026-06-04', '2026-06-04')],
      allocations: [
        allocation({ startDate: '2026-06-01', hoursPerDay: 4 }),
        allocation({ startDate: '2026-06-02', hoursPerDay: 0 }),
        allocation({ startDate: '2026-06-03', hoursPerDay: 4 }),
        allocation({ startDate: '2026-06-04', hoursPerDay: 4 }),
      ],
    };
    const hourly = section(rows).resources['r-diana']!.window;
    const blocks = section(rows, { company: companyRow({ schedulingMode: 'blocks' }) }).resources[
      'r-diana'
    ]!.window;
    // A zero-hour booking on time off is over nothing, but a Block on time off still clashes.
    assert.deepEqual(hourly.timeOffConflict.slice(0, 5), [true, false, false, true, false]);
    assert.deepEqual(blocks.timeOffConflict.slice(0, 5), [true, true, false, true, false]);
  });

  test('changing the company working days recalculates capacity without moving rows', ({
    assert,
  }) => {
    const rows = { allocations: [allocation({ startDate: '2026-06-01', endDate: '2026-06-05' })] };
    const before = section(rows).resources['r-diana']!.window;
    const after = section(rows, { company: companyRow({ workingDays: [1, 2, 3] }) }).resources[
      'r-diana'
    ]!.window;
    assert.deepEqual(before.allocated.slice(0, 5), [4, 4, 4, 4, 4]);
    assert.deepEqual(after.allocated.slice(0, 5), [4, 4, 4, 0, 0]);
    assert.deepEqual(after.available.slice(0, 5), [8, 8, 8, 0, 0]);
    assert.equal(rows.allocations[0]!.startDate, '2026-06-01');
    assert.equal(rows.allocations[0]!.endDate, '2026-06-05');
  });

  test('overSoon covers today to today + 13, whatever window is read', ({ assert }) => {
    const overSoonFor = (date: string) =>
      buildCapacitySection({
        data: data({ allocations: [allocation({ startDate: date, hoursPerDay: 9 })] }),
        company: companyRow(),
        today: '2026-06-03',
        window: { from: '2026-01-05', to: '2026-01-11' },
      }).resources['r-diana']!.overSoon;
    assert.isFalse(overSoonFor('2026-06-02'));
    assert.isTrue(overSoonFor('2026-06-03'));
    assert.isTrue(overSoonFor('2026-06-16'));
    assert.isFalse(overSoonFor('2026-06-17'));
  });

  test('blocks mode places allocations without hourly load', ({ assert }) => {
    const rows = { allocations: [allocation({ startDate: '2026-06-01', hoursPerDay: 12 })] };
    const hourly = section(rows).resources['r-diana']!.window;
    const blocks = section(rows, { company: companyRow({ schedulingMode: 'blocks' }) }).resources[
      'r-diana'
    ]!.window;
    assert.deepEqual([hourly.allocated[0], hourly.over[0]], [12, true]);
    assert.deepEqual([blocks.allocated[0], blocks.over[0]], [0, false]);
  });

  test('confirmed hours leave tentative allocations out and keep completed ones', ({ assert }) => {
    const { window } = section({
      allocations: [
        allocation({ startDate: '2026-06-01', hoursPerDay: 4 }),
        allocation({ startDate: '2026-06-01', hoursPerDay: 3, status: 'tentative' }),
        allocation({ startDate: '2026-06-01', hoursPerDay: 2, status: 'completed' }),
      ],
    }).resources['r-diana']!;
    assert.equal(window.allocated[0], 9);
    // Completed work happened, so it stays in the confirmed hours.
    assert.equal(window.confirmedAllocated[0], 6);
  });

  test('defaults to the scheduler window and covers the 12-week horizon', ({ assert }) => {
    const build = (weekStartsOn: 0 | 1) =>
      buildCapacitySection({
        data: data({}),
        company: companyRow({ weekStartsOn }),
        today: '2026-06-03',
      });
    const monday = build(1);
    assert.deepEqual(monday.window, { from: '2026-05-04', to: '2026-09-28' });
    assert.deepEqual(monday.horizon, { from: '2026-06-03', to: '2026-08-23' });
    assert.lengthOf(monday.resources['r-diana']!.window.over, 148);
    assert.lengthOf(monday.resources['r-diana']!.horizon.over, 82);
    const sunday = build(0);
    assert.deepEqual(sunday.window, { from: '2026-05-03', to: '2026-09-27' });
    assert.deepEqual(sunday.horizon, { from: '2026-06-03', to: '2026-08-22' });
  });

  test('a Sunday week start with unset working days works Sunday to Thursday', ({ assert }) => {
    const { horizon } = buildCapacitySection({
      data: data({
        resources: [resource('r-diana', { workingDays: [0, 1, 2, 3, 4, 5, 6] })],
        allocations: [allocation({ startDate: '2026-06-05', endDate: '2026-06-07' })],
      }),
      company: companyRow({ weekStartsOn: 0, workingDays: null }),
      today: '2026-06-03',
    }).resources['r-diana']!;
    // Wednesday 3 June is index 0: Friday 5 June is index 2, Sunday 7 June index 4.
    assert.deepEqual([horizon.available[2], horizon.available[4]], [0, 8]);
    assert.deepEqual([horizon.allocated[2], horizon.allocated[4]], [0, 4]);
  });
});

test.group('capacity section on the example company', (group) => {
  group.setup(() => freshDatabase());

  test('equals the shared straight-line capacity window for every resource', async ({ assert }) => {
    await resetPlanningFixture();
    const stored = buildActiveData(await readState('a-studio', true));
    const company = stored.companies[0]!;
    const today = '2026-06-03';
    const result = buildCapacitySection({ data: stored, company, today });
    const companyWorkingDays: Weekday[] = normalizeCompanyWorkingDays(
      company.workingDays,
      company.weekStartsOn ?? 1
    );
    const tracked = stored.resources.filter(isCapacityTracked);
    assert.isAbove(tracked.length, 0);
    assert.sameMembers(
      Object.keys(result.resources),
      tracked.map((row) => row.id)
    );
    let overDays = 0;
    for (const row of tracked) {
      const allocations = stored.allocations.filter((entry) => entry.resourceId === row.id);
      const straightLine = (range: { from: string; to: string }, rows: Allocation[]) =>
        buildCapacityWindow({
          resource: row,
          allocations: rows,
          timeOff: stored.timeOff.filter((entry) => entry.resourceId === row.id),
          start: range.from,
          end: range.to,
          effectiveWeek: resolveEffectiveWorkingWeek(row, companyWorkingDays),
          closures: stored.closures,
        });
      const expected = (range: { from: string; to: string }) => {
        const all = straightLine(range, allocations);
        const confirmed = straightLine(
          range,
          allocations.filter((entry) => entry.status !== 'tentative')
        );
        return {
          allocated: all.map((day) => day.allocated),
          confirmedAllocated: confirmed.map((day) => day.allocated),
          available: all.map((day) => day.available),
          over: all.map((day) => day.over),
        };
      };
      const window = expected(result.window);
      const actual = result.resources[row.id]!;
      // The straight-line figures carry no time-off conflict; its rule has its own case above.
      const figures = ({ timeOffConflict, ...days }: CapacityDays) => {
        assert.lengthOf(timeOffConflict, days.over.length);
        return days;
      };
      assert.deepEqual(figures(actual.window), window, row.id);
      assert.deepEqual(figures(actual.horizon), expected(result.horizon), row.id);
      overDays += window.over.filter(Boolean).length;
    }
    // The example company books tentative work, so the confirmed comparison is not all hours again.
    assert.isTrue(stored.allocations.some((entry) => entry.status === 'tentative'));
    // The example company books someone over capacity, so the comparison covers that case.
    assert.isAbove(overDays, 0);
  });
});
