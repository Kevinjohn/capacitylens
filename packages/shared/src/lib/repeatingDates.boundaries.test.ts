import { describe, expect, it } from 'vitest';
import { MAX_ISO_DATE } from './dateMath.js';
import {
  ALLOCATION_REPEAT_POLICY,
  TIME_OFF_REPEAT_POLICY,
  defaultRepeatUntilDate,
  generateRepeatingStartDates,
  maximumRepeatUntilDate,
  RepeatingDateError,
} from './repeatingDates.js';
import type { RepeatingDatePolicy } from './repeatingDates.js';

// repeatingDates.test.ts covers the cadences; this file pins the exact boundary of each limit,
// using caller policies to reach month offsets the built-in policies never request.

function policy(overrides: Partial<RepeatingDatePolicy>): RepeatingDatePolicy {
  return { ...ALLOCATION_REPEAT_POLICY, ...overrides };
}

function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('Expected the call to throw.');
}

describe('repeat policies', () => {
  it('caps allocation repeats on the anchor day and time off on the month end', () => {
    expect(ALLOCATION_REPEAT_POLICY.maximumCutoff).toBe('anchor-day');
    expect(maximumRepeatUntilDate('2026-01-15')).toBe('2026-07-15');
    expect(TIME_OFF_REPEAT_POLICY.maximumCutoff).toBe('month-end');
  });

  it.each([
    [ALLOCATION_REPEAT_POLICY, 'allocation'],
    [TIME_OFF_REPEAT_POLICY, 'entry'],
  ])('names the occurrence noun in the limit message', (base, noun) => {
    expect(base.occurrenceNoun).toBe(noun);
    const error = thrown(() =>
      generateRepeatingStartDates(
        '2026-01-05',
        '2026-01-19',
        { kind: 'weeks', interval: 1 },
        { ...base, maxOccurrences: 2 },
      ),
    );
    expect(error).toBeInstanceOf(RepeatingDateError);
    expect(error).toMatchObject({
      code: 'occurrence-limit',
      message: `Repeating ${noun} generation exceeds its 2-${noun} limit.`,
    });
  });
});

describe('occurrence limit', () => {
  const weekly = { kind: 'weeks', interval: 1 } as const;

  it('accepts exactly the maximum number of occurrences', () => {
    expect(
      generateRepeatingStartDates('2026-01-05', '2026-01-19', weekly, policy({ maxOccurrences: 3 }))
        .startDates,
    ).toEqual(['2026-01-05', '2026-01-12', '2026-01-19']);
  });

  it('throws on the first occurrence beyond the maximum', () => {
    expect(
      thrown(() =>
        generateRepeatingStartDates(
          '2026-01-05',
          '2026-01-19',
          weekly,
          policy({ maxOccurrences: 2 }),
        ),
      ),
    ).toMatchObject({ code: 'occurrence-limit' });
  });
});

describe('default cutoff', () => {
  it('keeps the anchor day when the policy asks for it', () => {
    expect(defaultRepeatUntilDate('2026-01-15', policy({ defaultCutoff: 'anchor-day' }))).toBe(
      '2026-03-15',
    );
    expect(defaultRepeatUntilDate('2026-01-15')).toBe('2026-03-31');
  });

  it('clamps a suggestion beyond the maximum and keeps one equal to it', () => {
    const longer = policy({ defaultCalendarMonths: 8, defaultCutoff: 'anchor-day' });
    expect(defaultRepeatUntilDate('2026-01-15', longer)).toBe('2026-07-15');
    const equal = policy({ defaultCalendarMonths: 6, defaultCutoff: 'anchor-day' });
    expect(defaultRepeatUntilDate('2026-01-15', equal)).toBe('2026-07-15');
  });

  it('clamps cutoffs past the calendar to its last supported date', () => {
    expect(maximumRepeatUntilDate('9999-09-15')).toBe(MAX_ISO_DATE);
    expect(defaultRepeatUntilDate('9999-12-15')).toBe(MAX_ISO_DATE);
  });
});

describe('calendar-month offsets', () => {
  it('accepts the first and last supported months exactly', () => {
    // A zero or negative offset is reachable only through a caller policy.
    expect(maximumRepeatUntilDate('0001-01-15', policy({ maximumCalendarMonths: 0 }))).toBe(
      '0001-01-15',
    );
    expect(maximumRepeatUntilDate('0001-02-15', policy({ maximumCalendarMonths: -1 }))).toBe(
      '0001-01-15',
    );
    expect(maximumRepeatUntilDate('9999-06-15')).toBe('9999-12-15');
  });

  it('clamps an offset just beyond either end to the last supported date', () => {
    expect(maximumRepeatUntilDate('0001-01-15', policy({ maximumCalendarMonths: -1 }))).toBe(
      MAX_ISO_DATE,
    );
    expect(maximumRepeatUntilDate('9999-07-15')).toBe(MAX_ISO_DATE);
  });

  it('clamps a non-integer offset to the last supported date', () => {
    expect(maximumRepeatUntilDate('2026-01-15', policy({ maximumCalendarMonths: 1.5 }))).toBe(
      MAX_ISO_DATE,
    );
  });
});

describe('monthly generation boundaries', () => {
  it('stops monthly-date repeats at the end of the calendar', () => {
    expect(
      generateRepeatingStartDates('9999-10-31', MAX_ISO_DATE, { kind: 'monthly-date' }).startDates,
    ).toEqual(['9999-10-31', '9999-11-30', '9999-12-31']);
  });

  it('includes a last-weekday candidate equal to the cutoff and excludes later ones', () => {
    const lastFriday = { kind: 'monthly-last-weekday' } as const;
    expect(generateRepeatingStartDates('2026-01-30', '2026-03-27', lastFriday).startDates).toEqual([
      '2026-01-30',
      '2026-02-27',
      '2026-03-27',
    ]);
    expect(generateRepeatingStartDates('2026-01-30', '2026-03-26', lastFriday).startDates).toEqual([
      '2026-01-30',
      '2026-02-27',
    ]);
  });
});

describe('weekly generation boundaries', () => {
  it('includes a candidate equal to the cutoff and excludes the next', () => {
    const weekly = { kind: 'weeks', interval: 2 } as const;
    expect(generateRepeatingStartDates('2026-01-05', '2026-01-19', weekly).startDates).toEqual([
      '2026-01-05',
      '2026-01-19',
    ]);
    expect(generateRepeatingStartDates('2026-01-05', '2026-02-01', weekly).startDates).toEqual([
      '2026-01-05',
      '2026-01-19',
    ]);
  });
});
