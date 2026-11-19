import { test } from '@japa/runner';
import { FIXTURE_COMPANY, FIXTURE_RESOURCE_PERSON } from '@capacitylens/shared/data/fixtures';
import {
  createEmptyAppData,
  type AppData,
  type SchedulingMode,
} from '@capacitylens/shared/types/entities';
import { PlanningOperationError } from '#services/planning/execute';
import {
  buildAllocationOccurrences,
  buildTimeOffOccurrences,
  type RepeatRange,
} from '#services/planning/repeat_occurrences';

const companyId = FIXTURE_COMPANY.id;
const first = {
  resourceId: FIXTURE_RESOURCE_PERSON.id,
  startDate: '2026-06-01',
  endDate: '2026-06-03',
};

function companyData(schedulingMode: SchedulingMode): AppData {
  return {
    ...createEmptyAppData(),
    accounts: [
      { ...FIXTURE_COMPANY, schedulingMode, weekStartsOn: 1, workingDays: [1, 2, 3, 4, 5] },
    ],
    resources: [{ ...FIXTURE_RESOURCE_PERSON, workingDays: [1, 2, 3] }],
  };
}

const occurrences = (schedulingMode: SchedulingMode, repeat: RepeatRange, from = first) =>
  buildAllocationOccurrences(companyData(schedulingMode), companyId, from, repeat).map(
    ({ startDate, endDate }) => [startDate, endDate]
  );

// The same literals pin the shared projection in packages/shared repeatingOccurrences.test.ts.
test.group('allocation repeat occurrences', () => {
  test('a weekly repeat keeps the working span of a Monday to Wednesday person', ({ assert }) => {
    assert.deepEqual(
      occurrences('days', { pattern: { kind: 'weeks', interval: 1 }, until: '2026-06-22' }),
      [
        ['2026-06-01', '2026-06-03'],
        ['2026-06-08', '2026-06-10'],
        ['2026-06-15', '2026-06-17'],
        ['2026-06-22', '2026-06-24'],
      ]
    );
  });

  test('a span across non-working days keeps its count of working days', ({ assert }) => {
    // Wednesday to the next Monday is two working days for a Monday to Wednesday person.
    const wednesday = { ...first, startDate: '2026-06-03', endDate: '2026-06-08' };
    assert.deepEqual(
      occurrences(
        'days',
        { pattern: { kind: 'weeks', interval: 1 }, until: '2026-06-17' },
        wednesday
      ),
      [
        ['2026-06-03', '2026-06-08'],
        ['2026-06-10', '2026-06-15'],
        ['2026-06-17', '2026-06-22'],
      ]
    );
  });

  test('a monthly repeat counts working days past non-working starts', ({ assert }) => {
    assert.deepEqual(
      occurrences('days', { pattern: { kind: 'monthly-date' }, until: '2026-08-31' }),
      [
        ['2026-06-01', '2026-06-03'],
        ['2026-07-01', '2026-07-07'],
        ['2026-08-01', '2026-08-05'],
      ]
    );
  });

  test('an hourly company keeps the calendar span', ({ assert }) => {
    assert.deepEqual(
      occurrences('hourly', { pattern: { kind: 'monthly-date' }, until: '2026-08-31' }),
      [
        ['2026-06-01', '2026-06-03'],
        ['2026-07-01', '2026-07-03'],
        ['2026-08-01', '2026-08-03'],
      ]
    );
  });

  test('a repeat the shared rules refuse is a validation error', ({ assert }) => {
    for (const until of ['2026-06-07', '2026-12-02']) {
      assert.throws(
        () => occurrences('days', { pattern: { kind: 'weeks', interval: 1 }, until }),
        PlanningOperationError
      );
    }
  });
});

test.group('time-off repeat occurrences', () => {
  const dates = (entry: { startDate: string; endDate: string }, repeat: RepeatRange) =>
    buildTimeOffOccurrences(entry, repeat).map(({ startDate, endDate }) => [startDate, endDate]);

  test('a monthly last-weekday repeat keeps the calendar span on each last Tuesday', ({
    assert,
  }) => {
    assert.deepEqual(
      dates(
        { startDate: '2026-06-30', endDate: '2026-07-01' },
        { pattern: { kind: 'monthly-last-weekday' }, until: '2026-09-30' }
      ),
      [
        ['2026-06-30', '2026-07-01'],
        ['2026-07-28', '2026-07-29'],
        ['2026-08-25', '2026-08-26'],
        ['2026-09-29', '2026-09-30'],
      ]
    );
  });

  test('time off repeats over its own horizon, past where an allocation stops', ({ assert }) => {
    const weekly = dates(
      { startDate: '2026-06-01', endDate: '2026-06-01' },
      { pattern: { kind: 'weeks', interval: 1 }, until: '2027-01-04' }
    );
    assert.lengthOf(weekly, 32);
    assert.deepEqual(weekly.at(-1), ['2027-01-04', '2027-01-04']);
  });

  test('a repeat the shared rules refuse is a validation error', ({ assert }) => {
    const entry = { startDate: '2026-06-30', endDate: '2026-07-01' };
    for (const until of ['2026-06-29', '2027-06-30']) {
      assert.throws(
        () => dates(entry, { pattern: { kind: 'monthly-last-weekday' }, until }),
        PlanningOperationError
      );
    }
  });
});
