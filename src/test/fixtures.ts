import type { Resource, Weekday } from '../types/entities'
import type { Draft } from '../store/useStore'

// Shared test fixtures. Centralises the Mon–Fri working-week (previously repeated
// as `[1, 2, 3, 4, 5] as Weekday[]` across ~7 fixtures) and a resource-draft factory
// so resource-shaped test data has one definition to update.

/** Mon–Fri, typed as Weekday[] so call sites don't need the `as Weekday[]` cast. */
export const WORKDAYS: Weekday[] = [1, 2, 3, 4, 5]

/** A valid person Draft<Resource>; override any field per test. */
export function makeResourceDraft(overrides: Partial<Draft<Resource>> = {}): Draft<Resource> {
  return {
    kind: 'person',
    name: 'Test Person',
    role: 'Designer',
    employmentType: 'permanent',
    workingHoursPerDay: 8,
    workingDays: WORKDAYS,
    color: '#6366f1',
    ...overrides,
  }
}
