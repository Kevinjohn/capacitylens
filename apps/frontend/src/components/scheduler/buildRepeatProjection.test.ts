import { describe, expect, it } from 'vitest';
import { MAX_HOURS_PER_DAY } from '@capacitylens/shared/types/entities';
import { makeActivity, makeResource } from '@/test/fixtures';
import { buildRepeatProjection } from './buildRepeatProjection';

type ProjectionInput = Parameters<typeof buildRepeatProjection>[0];

// A Monday-to-Tuesday hourly allocation repeated weekly for four occurrences. Every guard test
// changes exactly one field from this valid baseline, so a null result points at that guard.
function validInput(overrides: Partial<ProjectionInput> = {}): ProjectionInput {
  return {
    activityId: 't1',
    create: { resourceId: 'r1', startDate: '2027-01-04', endDate: '2027-01-05' },
    attributedProjectId: undefined,
    daysOfWork: 2,
    daysOver: 2,
    effEndDate: '2027-01-05',
    effHoursPerDay: 4,
    ignoreWeekends: false,
    isBlocks: false,
    isDays: false,
    isExternal: false,
    mode: 'hourly',
    note: '',
    task: '',
    repeat: 'weekly',
    repeatUntil: '2027-01-25',
    repeatUntilMaximum: '2027-12-31',
    repeatUntilMinimum: '2027-01-11',
    resourceId: 'r1',
    selectedActivity: makeActivity(),
    selectedEffectiveProjectId: 'p1',
    selectedResource: makeResource(),
    selectedEffectiveWeek: { kind: 'days', days: [1, 2, 3, 4, 5] },
    spanFitsDateDomain: true,
    startDate: '2027-01-04',
    status: 'confirmed',
    validDaysOver: true,
    ...overrides,
  };
}

function expectRejected(overrides: Partial<ProjectionInput>) {
  expect(buildRepeatProjection(validInput(overrides))).toBeNull();
}

function expectAccepted(overrides: Partial<ProjectionInput>) {
  expect(buildRepeatProjection(validInput(overrides))).not.toBeNull();
}

describe('buildRepeatProjection', () => {
  it('projects one draft per repeated start date for a valid creation', () => {
    const projection = buildRepeatProjection(validInput());
    expect(projection?.startDates).toEqual([
      '2027-01-04',
      '2027-01-11',
      '2027-01-18',
      '2027-01-25',
    ]);
    expect(projection?.drafts.map((draft) => draft.startDate)).toEqual(projection?.startDates);
    expect(projection?.drafts[0]).toMatchObject({
      resourceId: 'r1',
      activityId: 't1',
      endDate: '2027-01-05',
      hoursPerDay: 4,
      status: 'confirmed',
      ignoreWeekends: false,
    });
    expect(projection?.drafts[0]).not.toHaveProperty('note');
    expect(projection?.drafts[0]).not.toHaveProperty('task');
    expect(projection?.drafts[0]).not.toHaveProperty('projectId');
  });

  it('carries note, task and attributed project only when present', () => {
    const projection = buildRepeatProjection(
      validInput({ note: 'Bring the deck', task: 'Review', attributedProjectId: 'p1' }),
    );
    expect(projection?.drafts[0]).toMatchObject({
      note: 'Bring the deck',
      task: 'Review',
      projectId: 'p1',
    });
  });

  it('forces ignoreWeekends for external resources', () => {
    const external = makeResource({ kind: 'external' });
    const projection = buildRepeatProjection(
      validInput({ isExternal: true, selectedResource: external, effHoursPerDay: 0 }),
    );
    expect(projection?.drafts.every((draft) => draft.ignoreWeekends)).toBe(true);
  });

  it('returns null outside a repeating creation context', () => {
    expectRejected({ create: undefined });
    expectRejected({ repeat: 'none' });
    expectRejected({ selectedResource: undefined });
    expectRejected({ selectedEffectiveWeek: undefined });
    expectRejected({ resourceId: '' });
    expectRejected({ activityId: '' });
    expectRejected({ selectedActivity: undefined });
  });

  it('returns null when the allocation span is not a valid date range', () => {
    expectRejected({ startDate: 'not-a-date' });
    expectRejected({ effEndDate: 'not-a-date' });
    expectRejected({ effEndDate: '2027-01-03' });
    expectAccepted({ effEndDate: '2027-01-04' });
  });

  it('keeps repeat until inside the minimum and maximum bounds', () => {
    expectRejected({ repeatUntil: 'not-a-date' });
    expectRejected({ repeatUntil: '2027-01-10' });
    expectAccepted({ repeatUntil: '2027-01-11' });
    expectRejected({ repeatUntilMaximum: undefined });
    expectRejected({ repeatUntil: '2027-02-02', repeatUntilMaximum: '2027-02-01' });
    expectAccepted({ repeatUntil: '2027-02-01', repeatUntilMaximum: '2027-02-01' });
  });

  it('requires a valid days-over span in days and blocks modes', () => {
    expectRejected({ isDays: true, mode: 'days', validDaysOver: false });
    expectRejected({ isDays: true, mode: 'days', spanFitsDateDomain: false });
    expectRejected({ isBlocks: true, mode: 'blocks', validDaysOver: false });
    expectAccepted({ isBlocks: true, mode: 'blocks', effHoursPerDay: 0 });
    expectAccepted({ isDays: true, mode: 'days' });
  });

  it('requires positive days of work in days mode', () => {
    expectRejected({ isDays: true, mode: 'days', daysOfWork: 0 });
    expectRejected({ isDays: true, mode: 'days', daysOfWork: Number.NaN });
    expectAccepted({ isBlocks: true, mode: 'blocks', daysOfWork: 0 });
  });

  it('requires hours per day between zero exclusive and the daily maximum in hourly mode', () => {
    expectRejected({ effHoursPerDay: 0 });
    expectRejected({ effHoursPerDay: Number.NaN });
    expectRejected({ effHoursPerDay: Number.POSITIVE_INFINITY });
    expectRejected({ effHoursPerDay: MAX_HOURS_PER_DAY + 1 });
    expectAccepted({ effHoursPerDay: MAX_HOURS_PER_DAY });
    expectAccepted({
      isExternal: true,
      selectedResource: makeResource({ kind: 'external' }),
      effHoursPerDay: 0,
    });
  });

  it('returns null when a placeholder cannot take the selected project', () => {
    const unbound = makeResource({ kind: 'placeholder', projectId: null });
    expectRejected({ selectedResource: unbound, selectedEffectiveProjectId: 'p1' });
    const bound = makeResource({ kind: 'placeholder', projectId: 'p1' });
    expectAccepted({ selectedResource: bound, selectedEffectiveProjectId: 'p1' });
  });

  it('returns null instead of throwing when the projection cannot fit the date domain', () => {
    expectRejected({
      repeatUntil: '2027-12-31',
      repeatUntilMaximum: '2028-12-31',
      startDate: '2027-01-04',
    });
  });
});
