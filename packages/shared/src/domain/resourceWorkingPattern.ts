import {
  buildExternalCapacityDefaults,
  buildPlaceholderCapacityDefaults,
} from '../types/entities.js'
import type { Resource } from '../types/entities.js'

type WorkingPattern = Pick<Resource, 'workingDays' | 'halfDays'>

/** True when every half day is also a working day. */
export function areHalfDaysWithinWorkingDays(
  workingDays: readonly unknown[],
  halfDays: readonly unknown[]
): boolean {
  return halfDays.every((day) => workingDays.includes(day))
}

/** The fixed working pattern a placeholder or external resource must keep, or null for a person,
 * who chooses their own. */
export function parseFixedWorkingPattern(kind: unknown): WorkingPattern | null {
  if (kind === 'placeholder') return buildPlaceholderCapacityDefaults()
  if (kind !== 'external') return null
  const { workingDays, halfDays } = buildExternalCapacityDefaults()
  return { workingDays, halfDays }
}

/** True when `actual` is a weekday list equal to `expected`, in the same order. */
export function isSameWeekdays(actual: unknown, expected: readonly number[]): boolean {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((day, index) => day === expected[index])
  )
}
