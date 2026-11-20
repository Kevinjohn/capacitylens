import { describe, expect, it } from 'vitest';
import {
  parseFixedWorkingPattern,
  areHalfDaysWithinWorkingDays,
  isSameWeekdays,
} from './resourceWorkingPattern.js';

describe('areHalfDaysWithinWorkingDays', () => {
  it('accepts half days that are working days, including none', () => {
    expect(areHalfDaysWithinWorkingDays([1, 2, 3], [2])).toBe(true);
    expect(areHalfDaysWithinWorkingDays([1, 2, 3], [])).toBe(true);
  });

  it('refuses a half day outside the working week', () => {
    expect(areHalfDaysWithinWorkingDays([1, 2, 3], [5])).toBe(false);
  });
});

describe('parseFixedWorkingPattern', () => {
  it('fixes placeholders and external resources to the default week', () => {
    expect(parseFixedWorkingPattern('placeholder')).toEqual({
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
    });
    expect(parseFixedWorkingPattern('external')).toEqual({
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
    });
  });

  it('leaves a person free to choose', () => {
    expect(parseFixedWorkingPattern('person')).toBeNull();
  });
});

describe('isSameWeekdays', () => {
  it('compares weekday lists in order', () => {
    expect(isSameWeekdays([1, 2], [1, 2])).toBe(true);
    expect(isSameWeekdays([2, 1], [1, 2])).toBe(false);
    expect(isSameWeekdays([1], [1, 2])).toBe(false);
    expect(isSameWeekdays('1,2', [1, 2])).toBe(false);
  });
});
