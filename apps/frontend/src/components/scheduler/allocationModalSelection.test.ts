import { describe, expect, it } from 'vitest';
import { addDaysISO, daysInclusive, MAX_ISO_DATE } from '@capacitylens/shared/lib/dateMath';
import type { EffectiveWorkingWeek } from '@capacitylens/shared/lib/effectiveWorkingWeek';
import {
  blockHoursPerDay,
  hoursPerDayFor,
  MAX_SPAN_DAYS,
  maxSpanDaysForStart,
} from '@capacitylens/shared/lib/schedulingDays';
import { FULL_DAY_HOURS } from '@capacitylens/shared/types/entities';
import type { ISODate, SchedulingMode } from '@capacitylens/shared/types/entities';
import { makeActivity, makeResource, WORKDAYS } from '@/test/fixtures';
import {
  ANY_PROJECT_SELECTION,
  buildActivityScope,
  buildEffectiveAllocationValues,
  hasWorkingSpan,
  INTERNAL_PROJECT_SELECTION,
  isActivityInProjectSelection,
  resolveAttributedProject,
  resolveProjectSelection,
} from './allocationModalSelection';
import type { EffectiveAllocationInput } from './allocationModalTypes';

// The modal derives its selector choice and effective span from these helpers alone, so each
// branch is pinned here directly instead of through the dialog.

const WEEK: EffectiveWorkingWeek = { kind: 'days', days: WORKDAYS };
const person = makeResource();
const external = makeResource({ id: 'ext', kind: 'external' });
const internalActivity = makeActivity({ id: 'ti', kind: 'internal', projectId: null });
const repeatableActivity = makeActivity({ id: 'tr', kind: 'repeatable', projectId: null });
const projectActivity = makeActivity({ id: 'tp', kind: 'project', projectId: 'p1' });
// Exactly MAX_SPAN_DAYS calendar days remain from this start, one fewer from the next day.
const LAST_UNLIMITED_START = addDaysISO(MAX_ISO_DATE, -(MAX_SPAN_DAYS - 1));

function input(overrides: Partial<EffectiveAllocationInput> = {}): EffectiveAllocationInput {
  return {
    resource: person,
    effectiveWeek: WEEK,
    mode: 'days',
    startDate: '2026-06-01',
    endDate: '2026-06-03',
    hoursPerDay: 8,
    daysOver: 5,
    daysOfWork: 5,
    ignoreWeekends: false,
    ...overrides,
  };
}

describe('project selection helpers', () => {
  it('uses distinct non-empty sentinels', () => {
    expect(INTERNAL_PROJECT_SELECTION).toBe('__allocation_internal__');
    expect(ANY_PROJECT_SELECTION).toBe('__allocation_any_project__');
  });

  it('resolveProjectSelection maps each activity kind to its selector choice', () => {
    expect(resolveProjectSelection(repeatableActivity)).toBe(ANY_PROJECT_SELECTION);
    expect(resolveProjectSelection(projectActivity)).toBe('p1');
    expect(resolveProjectSelection(makeActivity({ kind: 'project', projectId: null }))).toBe(
      INTERNAL_PROJECT_SELECTION,
    );
    expect(resolveProjectSelection(internalActivity)).toBe(INTERNAL_PROJECT_SELECTION);
    expect(resolveProjectSelection(undefined)).toBe(INTERNAL_PROJECT_SELECTION);
  });

  it('resolveAttributedProject returns a project only for an all-projects activity with a concrete choice', () => {
    expect(resolveAttributedProject(repeatableActivity, 'p1')).toBe('p1');
    expect(resolveAttributedProject(repeatableActivity, INTERNAL_PROJECT_SELECTION)).toBeUndefined();
    expect(resolveAttributedProject(repeatableActivity, ANY_PROJECT_SELECTION)).toBeUndefined();
    expect(resolveAttributedProject(projectActivity, 'p1')).toBeUndefined();
    expect(resolveAttributedProject(undefined, 'p1')).toBeUndefined();
  });

  it('isActivityInProjectSelection follows the kind × selection truth table', () => {
    const table: Array<[Parameters<typeof isActivityInProjectSelection>[0], string, boolean]> = [
      [{ kind: 'internal' }, INTERNAL_PROJECT_SELECTION, true],
      [{ kind: 'repeatable' }, INTERNAL_PROJECT_SELECTION, false],
      [{ kind: 'project', projectId: 'p1' }, INTERNAL_PROJECT_SELECTION, false],
      [{ kind: 'internal' }, ANY_PROJECT_SELECTION, false],
      [{ kind: 'repeatable' }, ANY_PROJECT_SELECTION, true],
      [{ kind: 'project', projectId: 'p1' }, ANY_PROJECT_SELECTION, false],
      [{ kind: 'internal' }, 'p1', false],
      [{ kind: 'repeatable' }, 'p1', true],
      [{ kind: 'project', projectId: 'p1' }, 'p1', true],
      [{ kind: 'project', projectId: 'p2' }, 'p1', false],
    ];
    for (const [activity, selection, expected] of table) {
      expect(isActivityInProjectSelection(activity, selection), `${activity.kind}/${selection}`).toBe(
        expected,
      );
    }
  });

  it('buildActivityScope inverts the selector choice', () => {
    expect(buildActivityScope(INTERNAL_PROJECT_SELECTION)).toEqual({ kind: 'internal' });
    expect(buildActivityScope(ANY_PROJECT_SELECTION)).toEqual({ kind: 'repeatable' });
    expect(buildActivityScope('p1')).toEqual({ kind: 'project', projectId: 'p1' });
  });
});

describe('hasWorkingSpan', () => {
  it('is true only for a capacity-tracked resource in a span-based mode', () => {
    const modes: SchedulingMode[] = ['hourly', 'days', 'blocks'];
    expect(modes.map((mode) => hasWorkingSpan(person, mode))).toEqual([false, true, true]);
    expect(modes.map((mode) => hasWorkingSpan(external, mode))).toEqual([false, false, false]);
    expect(modes.map((mode) => hasWorkingSpan(undefined, mode))).toEqual([false, false, false]);
  });
});

describe('buildEffectiveAllocationValues', () => {
  it('validates daysOver as a whole number from 1 through MAX_SPAN_DAYS', () => {
    const cases: Array<[number, boolean]> = [
      [0, false],
      [1, true],
      [1.5, false],
      [MAX_SPAN_DAYS, true],
      [MAX_SPAN_DAYS + 1, false],
    ];
    for (const [daysOver, expected] of cases) {
      expect(buildEffectiveAllocationValues(input({ daysOver })).validDaysOver, `${daysOver}`).toBe(
        expected,
      );
    }
  });

  it('keeps literal dates and hours outside span modes, zeroing external load', () => {
    const literal = buildEffectiveAllocationValues(input({ mode: 'hourly', daysOver: 0 }));
    expect(literal).toMatchObject({
      external: false,
      validDaysOver: false,
      spanFitsDateDomain: true,
      maximumDaysOver: MAX_SPAN_DAYS,
      spanLimitedByDateDomain: false,
      endDate: '2026-06-03',
      hoursPerDay: 8,
    });
    expect(buildEffectiveAllocationValues(input({ resource: external }))).toMatchObject({
      external: true,
      endDate: '2026-06-03',
      hoursPerDay: 0,
    });
  });

  it('flags a start so late that fewer than MAX_SPAN_DAYS calendar days remain', () => {
    const atLimit = { startDate: LAST_UNLIMITED_START, ignoreWeekends: true };
    const pastLimit = { startDate: addDaysISO(LAST_UNLIMITED_START, 1), ignoreWeekends: true };
    expect(daysInclusive(LAST_UNLIMITED_START, MAX_ISO_DATE)).toBe(MAX_SPAN_DAYS);
    for (const mode of ['hourly', 'days'] as const) {
      expect(buildEffectiveAllocationValues(input({ ...atLimit, mode })).spanLimitedByDateDomain).toBe(
        false,
      );
      expect(
        buildEffectiveAllocationValues(input({ ...pastLimit, mode })).spanLimitedByDateDomain,
      ).toBe(true);
    }
    expect(
      buildEffectiveAllocationValues(input({ mode: 'hourly', startDate: '' as ISODate }))
        .spanLimitedByDateDomain,
    ).toBe(false);
  });

  it('keeps the seeded quantity and literal end when the week has no effective days', () => {
    const noWeek = { effectiveWeek: { kind: 'none' } as const, daysOver: 4, daysOfWork: 2 };
    expect(buildEffectiveAllocationValues(input({ ...noWeek, mode: 'blocks' }))).toMatchObject({
      validDaysOver: true,
      spanFitsDateDomain: true,
      maximumDaysOver: MAX_SPAN_DAYS,
      spanLimitedByDateDomain: false,
      endDate: '2026-06-03',
      hoursPerDay: blockHoursPerDay(FULL_DAY_HOURS),
    });
    expect(buildEffectiveAllocationValues(input({ ...noWeek, mode: 'days' }))).toMatchObject({
      hoursPerDay: hoursPerDayFor(2, 4, FULL_DAY_HOURS),
    });
    expect(
      buildEffectiveAllocationValues(input({ ...noWeek, effectiveWeek: undefined, daysOver: 0 })),
    ).toMatchObject({ validDaysOver: false, spanFitsDateDomain: false });
  });

  it('derives the end from working days unless weekends are ignored', () => {
    const working = buildEffectiveAllocationValues(input({ daysOver: 6, daysOfWork: 3 }));
    expect(working).toMatchObject({
      endDate: '2026-06-08',
      hoursPerDay: hoursPerDayFor(3, 6, FULL_DAY_HOURS),
      spanFitsDateDomain: true,
      maximumDaysOver: maxSpanDaysForStart('2026-06-01', {
        workingDays: WORKDAYS,
        ignoreWeekends: false,
      }),
    });
    expect(
      buildEffectiveAllocationValues(input({ daysOver: 6, ignoreWeekends: true })).endDate,
    ).toBe('2026-06-06');
    expect(buildEffectiveAllocationValues(input({ mode: 'blocks' })).hoursPerDay).toBe(
      blockHoursPerDay(FULL_DAY_HOURS),
    );
  });

  it('collapses an invalid span to a single day and reports a span that overruns the date domain', () => {
    expect(buildEffectiveAllocationValues(input({ daysOver: 0 })).endDate).toBe('2026-06-01');
    const lastDay = { startDate: MAX_ISO_DATE, ignoreWeekends: true };
    expect(buildEffectiveAllocationValues(input({ ...lastDay, daysOver: 1 }))).toMatchObject({
      maximumDaysOver: 1,
      spanFitsDateDomain: true,
      endDate: MAX_ISO_DATE,
    });
    expect(buildEffectiveAllocationValues(input({ ...lastDay, daysOver: 2 }))).toMatchObject({
      spanFitsDateDomain: false,
      endDate: MAX_ISO_DATE,
    });
  });
});
