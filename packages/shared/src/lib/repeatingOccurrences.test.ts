import { describe, expect, it } from 'vitest';
import type { Allocation, TimeOff, Weekday } from '../types/entities.js';
import { effectiveWorkingWeek } from './effectiveWorkingWeek.js';
import { generateRepeatingStartDates } from './repeatingDates.js';
import type { RepeatPattern } from './repeatingDates.js';
import {
  buildRepeatedAllocationDrafts,
  buildRepeatedTimeOffDrafts,
} from './repeatingOccurrences.js';
import type { RepeatProjectionContext } from './repeatingOccurrences.js';

type AllocationDraft = Pick<
  Allocation,
  'resourceId' | 'activityId' | 'startDate' | 'endDate' | 'hoursPerDay' | 'status'
> &
  Partial<Pick<Allocation, 'note' | 'ignoreWorkingDays'>>;
type TimeOffDraft = Pick<TimeOff, 'resourceId' | 'startDate' | 'endDate' | 'type' | 'note'>;

interface RepeatContextTestInput {
  schedulingMode: RepeatProjectionContext['schedulingMode'];
  daysOver: number;
  resource?: ReturnType<typeof resourceContext> | undefined;
  accountWorkingDays?: Weekday[] | undefined;
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

const draft = (startDate: string, endDate: string = startDate): TimeOffDraft => ({
  resourceId: 'resource-1',
  startDate: startDate as TimeOffDraft['startDate'],
  endDate: endDate as TimeOffDraft['endDate'],
  type: 'holiday',
  note: 'Family trip',
});

describe('projectAllocationDates', () => {
  it('retains the exact first draft and copies all fields while changing only an hourly calendar span', () => {
    const base = baseDraft();
    const projected = buildRepeatedAllocationDrafts(
      base,
      ['2027-01-31', '2027-02-28', '2027-03-31'],
      repeatContext({ schedulingMode: 'hourly', daysOver: 99 }),
    );
    expect(projected[0]).toBe(base);
    expect(projected[1]).toEqual({ ...base, startDate: '2027-02-28', endDate: '2027-03-02' });
    expect(projected[2]).toEqual({ ...base, startDate: '2027-03-31', endDate: '2027-04-02' });
  });

  it('checks External first and preserves its validated zero-load literal span in every account mode', () => {
    const base = baseDraft({ hoursPerDay: 0, ignoreWorkingDays: true });
    for (const schedulingMode of ['hourly', 'days', 'blocks'] as const) {
      const projected = buildRepeatedAllocationDrafts(
        base,
        ['2027-01-31', '2027-02-28'],
        repeatContext({
          schedulingMode: schedulingMode,
          daysOver: 0,
          resource: resourceContext({ kind: 'external', workingDays: [] }),
        }),
      );
      expect(projected[1]).toMatchObject({
        startDate: '2027-02-28',
        endDate: '2027-03-02',
        hoursPerDay: 0,
        ignoreWorkingDays: true,
      });
    }
  });
});

describe('projectAllocationDates working spans', () => {
  it.each(['days', 'blocks'] as const)(
    'projects %s with the effective working span and preserves load',
    (mode) => {
      const base = baseDraft({
        startDate: '2026-06-01',
        endDate: '2026-06-03',
        hoursPerDay: mode === 'blocks' ? 0 : 6,
      });
      const projected = buildRepeatedAllocationDrafts(
        base,
        ['2026-06-01', '2026-06-06'],
        repeatContext({ schedulingMode: mode, daysOver: 3 }),
      );
      expect(projected[1]).toMatchObject({
        startDate: '2026-06-06',
        endDate: '2026-06-10',
        hoursPerDay: base.hoursPerDay,
      });
    },
  );

  it.each(['days', 'blocks'] as const)(
    'rejects %s repeats when a later occurrence cannot fit the complete working span',
    (mode) => {
      const base = baseDraft({
        startDate: '9999-09-30',
        endDate: '9999-10-02',
        hoursPerDay: mode === 'blocks' ? 0 : 8,
        ignoreWorkingDays: true,
      });
      expect(() =>
        buildRepeatedAllocationDrafts(
          base,
          ['9999-09-30', '9999-10-30', '9999-11-30', '9999-12-30'],
          repeatContext({ schedulingMode: mode, daysOver: 3 }),
        ),
      ).toThrow(/supported date range/i);
    },
  );

  it('honours custom work weeks and Ignore working days without moving the generated start', () => {
    const custom = buildRepeatedAllocationDrafts(
      baseDraft({ startDate: '2026-06-01', endDate: '2026-06-04' }),
      ['2026-06-01', '2026-06-03'],
      repeatContext({
        schedulingMode: 'days',
        daysOver: 2,
        resource: resourceContext({ workingDays: [2, 4] }),
      }),
    );
    expect(custom[1]).toMatchObject({ startDate: '2026-06-03', endDate: '2026-06-09' });

    const weekends = buildRepeatedAllocationDrafts(
      baseDraft({ startDate: '2026-06-01', endDate: '2026-06-03', ignoreWorkingDays: true }),
      ['2026-06-01', '2026-06-06'],
      repeatContext({ schedulingMode: 'days', daysOver: 3 }),
    );
    expect(weekends[1]).toMatchObject({ startDate: '2026-06-06', endDate: '2026-06-08' });
  });
});

describe('projectAllocationDates validation', () => {
  it('rejects a mismatched resource, a missing anchor and invalid working-span context', () => {
    expect(() =>
      buildRepeatedAllocationDrafts(
        baseDraft(),
        ['2027-01-31', '2027-02-28'],
        repeatContext({
          schedulingMode: 'hourly',
          daysOver: 1,
          resource: resourceContext({ id: 'other' }),
        }),
      ),
    ).toThrow(/does not match/i);
    expect(() =>
      buildRepeatedAllocationDrafts(
        baseDraft(),
        ['2027-02-28'],
        repeatContext({ schedulingMode: 'hourly', daysOver: 1 }),
      ),
    ).toThrow(/begin/i);
    expect(() =>
      buildRepeatedAllocationDrafts(
        baseDraft(),
        ['2027-01-31', '2027-02-28'],
        repeatContext({ schedulingMode: 'blocks', daysOver: 0 }),
      ),
    ).toThrow(/daysOver/i);
  });

  it.each([
    ['weekly', ['2026-06-01', '2026-06-08'], '2026-06-15'],
    ['monthly', ['2026-06-01', '2026-07-01'], '2026-07-08'],
  ] as const)(
    'projects %s working spans through the narrowed company week',
    (_, startDates, expectedEnd) => {
      const resource = resourceContext();
      const projected = buildRepeatedAllocationDrafts(
        baseDraft({ startDate: '2026-06-01', endDate: '2026-06-08' }),
        startDates,
        repeatContext({
          schedulingMode: 'days',
          daysOver: 5,
          resource: resource,
          accountWorkingDays: [1, 2, 3, 4],
        }),
      );

      expect(projected[1]).toMatchObject({ startDate: startDates[1], endDate: expectedEnd });
    },
  );

  it('rejects a working-span repeat before empty effective days can reach date math', () => {
    const resource = resourceContext({ workingDays: [1] });
    expect(() =>
      buildRepeatedAllocationDrafts(
        baseDraft({ startDate: '2026-06-01', endDate: '2026-06-01' }),
        ['2026-06-01', '2026-06-08'],
        repeatContext({
          schedulingMode: 'days',
          daysOver: 1,
          resource: resource,
          accountWorkingDays: [2],
        }),
      ),
    ).toThrow(/effective working day/i);

    expect(
      buildRepeatedAllocationDrafts(
        baseDraft({
          startDate: '2026-06-01',
          endDate: '2026-06-02',
          ignoreWorkingDays: true,
        }),
        ['2026-06-01', '2026-06-08'],
        repeatContext({
          schedulingMode: 'days',
          daysOver: 2,
          resource: resource,
          accountWorkingDays: [2],
        }),
      )[1],
    ).toMatchObject({ startDate: '2026-06-08', endDate: '2026-06-09', ignoreWorkingDays: true });
  });
});

describe('buildRepeatedTimeOffDrafts', () => {
  it('preserves inclusive calendar-day duration and all non-date fields', () => {
    const result = buildRepeatedTimeOffDrafts(draft('2026-03-27', '2026-03-29'), '2027-02-28', {
      kind: 'monthly-last-weekday',
    });

    expect(result.drafts).toHaveLength(12);
    expect(result.drafts[0]).toEqual(draft('2026-03-27', '2026-03-29'));
    expect(result.drafts.at(-1)).toEqual(draft('2027-02-26', '2027-02-28'));
    expect(
      result.drafts.every(
        ({ resourceId, type, note }) =>
          resourceId === 'resource-1' && type === 'holiday' && note === 'Family trip',
      ),
    ).toBe(true);
  });

  it('keeps weekly anchors stable across daylight-saving transitions', () => {
    const result = buildRepeatedTimeOffDrafts(draft('2026-03-20'), '2026-04-10', {
      kind: 'weeks',
      interval: 1,
    });

    expect(result.drafts.map(({ startDate }) => startDate)).toEqual([
      '2026-03-20',
      '2026-03-27',
      '2026-04-03',
      '2026-04-10',
    ]);
  });

  it('includes an occurrence starting on the cutoff even when its multi-day range ends later', () => {
    const result = buildRepeatedTimeOffDrafts(draft('2026-03-20', '2026-03-22'), '2026-03-27', {
      kind: 'weeks',
      interval: 1,
    });

    expect(result.drafts.at(-1)).toEqual(draft('2026-03-27', '2026-03-29'));
  });

  it('rejects the whole projection when any generated end exceeds the ISO domain', () => {
    expect(() =>
      buildRepeatedTimeOffDrafts(draft('9999-11-30', '9999-12-31'), '9999-12-31', {
        kind: 'monthly-last-weekday',
      }),
    ).toThrow(/supported|range|9999/i);
  });

  it('rejects a reversed base range before generating anything', () => {
    expect(() =>
      buildRepeatedTimeOffDrafts(draft('2026-03-29', '2026-03-27'), '2027-02-28', {
        kind: 'monthly-date',
      }),
    ).toThrow(/valid inclusive date range/i);
  });
});

describe('repeat occurrences pinned for the server', () => {
  const first = baseDraft({ startDate: '2026-06-01', endDate: '2026-06-03' });
  const occurrences = (
    until: string,
    pattern: RepeatPattern,
    schedulingMode: RepeatProjectionContext['schedulingMode'],
  ) =>
    buildRepeatedAllocationDrafts(
      first,
      generateRepeatingStartDates(first.startDate, until, pattern).startDates,
      repeatContext({
        schedulingMode,
        daysOver: 3,
        resource: resourceContext({ workingDays: [1, 2, 3] }),
      }),
    ).map(({ startDate, endDate }) => [startDate, endDate]);

  it('projects a weekly working span onto each start', () => {
    expect(occurrences('2026-06-22', { kind: 'weeks', interval: 1 }, 'days')).toEqual([
      ['2026-06-01', '2026-06-03'],
      ['2026-06-08', '2026-06-10'],
      ['2026-06-15', '2026-06-17'],
      ['2026-06-22', '2026-06-24'],
    ]);
  });

  it('projects a monthly working span past the non-working days', () => {
    expect(occurrences('2026-08-31', { kind: 'monthly-date' }, 'days')).toEqual([
      ['2026-06-01', '2026-06-03'],
      ['2026-07-01', '2026-07-07'],
      ['2026-08-01', '2026-08-05'],
    ]);
  });

  it('keeps the calendar span in hourly mode', () => {
    expect(occurrences('2026-08-31', { kind: 'monthly-date' }, 'hourly')).toEqual([
      ['2026-06-01', '2026-06-03'],
      ['2026-07-01', '2026-07-03'],
      ['2026-08-01', '2026-08-03'],
    ]);
  });

  it('repeats time off on the last weekday of each month', () => {
    const { drafts } = buildRepeatedTimeOffDrafts(draft('2026-06-30', '2026-07-01'), '2026-09-30', {
      kind: 'monthly-last-weekday',
    });
    expect(drafts.map(({ startDate }) => startDate)).toEqual([
      '2026-06-30',
      '2026-07-28',
      '2026-08-25',
      '2026-09-29',
    ]);
  });
});
