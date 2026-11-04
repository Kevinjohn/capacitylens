import { describe, expect, it } from 'vitest';
import {
  fixedWorkingPattern,
  halfDaysWithinWorkingDays,
  sameWeekdays,
} from './resourceWorkingPattern.js';

describe('halfDaysWithinWorkingDays', () => {
  it('accepts half days that are working days, including none', () => {
    expect(halfDaysWithinWorkingDays([1, 2, 3], [2])).toBe(true);
    expect(halfDaysWithinWorkingDays([1, 2, 3], [])).toBe(true);
  });

  it('refuses a half day outside the working week', () => {
    expect(halfDaysWithinWorkingDays([1, 2, 3], [5])).toBe(false);
  });
});

describe('fixedWorkingPattern', () => {
  it('fixes placeholders and external resources to the default week', () => {
    expect(fixedWorkingPattern('placeholder')).toEqual({
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
    });
    expect(fixedWorkingPattern('external')).toEqual({ workingDays: [1, 2, 3, 4, 5], halfDays: [] });
  });

  it('leaves a person free to choose', () => {
    expect(fixedWorkingPattern('person')).toBeNull();
  });
});

describe('sameWeekdays', () => {
  it('compares weekday lists in order', () => {
    expect(sameWeekdays([1, 2], [1, 2])).toBe(true);
    expect(sameWeekdays([2, 1], [1, 2])).toBe(false);
    expect(sameWeekdays([1], [1, 2])).toBe(false);
    expect(sameWeekdays('1,2', [1, 2])).toBe(false);
  });
});
