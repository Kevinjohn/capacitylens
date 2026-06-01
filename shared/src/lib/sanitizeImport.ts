import { isHexColor } from './color'
import type { ScopedEntityKey, Weekday } from '../types/entities'

// Import is the one write path that bypasses the form validators (a hand-edited or
// corrupt file never went through them). The store already drops allocations/time-off
// with broken ranges or dangling refs; this repairs the *value*-level fields the forms
// would otherwise have guarded — so a negative/NaN hoursPerDay, a junk status enum, or
// a non-hex colour can't land in the store and render as broken geometry.

const FALLBACK_COLOR = '#6366f1' // brand
const VALID_STATUS = ['confirmed', 'tentative', 'completed'] as const
const VALID_KIND = ['person', 'placeholder'] as const
const VALID_EMPLOYMENT = ['permanent', 'freelancer', 'contractor'] as const
const VALID_TIMEOFF = ['holiday', 'sick', 'unpaid', 'other'] as const

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback

const clampHours = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(v, 24) : fallback

// Allocation hours/day, unlike a resource's working day, may legitimately be 0: a
// "blocks"-mode booking persists hoursPerDay: 0 (see schedulingDays.blockHoursPerDay),
// so the span counts but the load doesn't. Accept >= 0 here so an imported or
// server-written block isn't silently inflated to a full-load allocation; only junk
// (NaN / negative / non-number) falls back.
const clampAllocHours = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(v, 24) : fallback

const safeColor = (v: unknown, fallback = FALLBACK_COLOR): string =>
  typeof v === 'string' && isHexColor(v) ? v : fallback

const safeInt = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

const safeWorkingDays = (v: unknown): Weekday[] => {
  if (!Array.isArray(v)) return [1, 2, 3, 4, 5]
  const days = v.filter((d): d is Weekday => typeof d === 'number' && d >= 0 && d <= 6)
  return days.length ? days : [1, 2, 3, 4, 5]
}

/** Repair the value-level fields of one imported scoped record in place. The record
 *  has already had its id remapped + accountId stamped; we only touch constrained
 *  fields, leaving names/notes/refs alone. */
export function sanitizeImportedRecord(
  key: ScopedEntityKey,
  rec: Record<string, unknown>,
): Record<string, unknown> {
  switch (key) {
    case 'resources':
      rec.kind = oneOf(rec.kind, VALID_KIND, 'person')
      rec.employmentType = oneOf(rec.employmentType, VALID_EMPLOYMENT, 'permanent')
      rec.workingHoursPerDay = clampHours(rec.workingHoursPerDay, 8)
      rec.workingDays = safeWorkingDays(rec.workingDays)
      rec.color = safeColor(rec.color)
      break
    case 'allocations':
      rec.status = oneOf(rec.status, VALID_STATUS, 'confirmed')
      rec.hoursPerDay = clampAllocHours(rec.hoursPerDay, 8)
      break
    case 'timeOff':
      rec.type = oneOf(rec.type, VALID_TIMEOFF, 'other')
      break
    case 'disciplines':
      rec.sortOrder = safeInt(rec.sortOrder, 0)
      if (rec.color !== undefined) rec.color = safeColor(rec.color)
      break
    case 'clients':
    case 'projects':
      rec.color = safeColor(rec.color)
      break
    case 'phases':
    case 'tasks':
      break
  }
  return rec
}
