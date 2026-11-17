import type { RepeatPattern } from '@capacitylens/shared/lib/repeatingDates';

/** A create-only cadence; persisted time-off entries remain independent dated records. */
export type TimeOffRepeatSelection =
  | 'weekly'
  | 'every-two-weeks'
  | 'every-three-weeks'
  | 'every-four-weeks'
  | 'monthly-date'
  | 'monthly-last-weekday';

const TIME_OFF_REPEAT_PATTERNS: Record<TimeOffRepeatSelection, RepeatPattern> = {
  weekly: { kind: 'weeks', interval: 1 },
  'every-two-weeks': { kind: 'weeks', interval: 2 },
  'every-three-weeks': { kind: 'weeks', interval: 3 },
  'every-four-weeks': { kind: 'weeks', interval: 4 },
  'monthly-date': { kind: 'monthly-date' },
  'monthly-last-weekday': { kind: 'monthly-last-weekday' },
};

/** The shared repeat pattern behind one time-off cadence choice. Pure. */
export function resolveTimeOffRepeatPattern(selection: TimeOffRepeatSelection): RepeatPattern {
  return TIME_OFF_REPEAT_PATTERNS[selection];
}
