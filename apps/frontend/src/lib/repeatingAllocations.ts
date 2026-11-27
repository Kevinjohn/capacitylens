import type { RepeatPattern } from '@capacitylens/shared/lib/repeatingDates'

/** Transient choice shown only while creating an allocation. */
export type RepeatSelection =
  'none' | 'weekly' | 'every-two-weeks' | 'every-three-weeks' | 'every-four-weeks' | 'monthly'

const REPEAT_PATTERNS: Record<Exclude<RepeatSelection, 'none'>, RepeatPattern> = {
  'weekly': { kind: 'weeks', interval: 1 },
  'every-two-weeks': { kind: 'weeks', interval: 2 },
  'every-three-weeks': { kind: 'weeks', interval: 3 },
  'every-four-weeks': { kind: 'weeks', interval: 4 },
  'monthly': { kind: 'monthly-date' },
}

/** Map a repeating form choice to the shared date-generation pattern. */
export function resolveRepeatPattern(selection: Exclude<RepeatSelection, 'none'>): RepeatPattern {
  return REPEAT_PATTERNS[selection]
}
