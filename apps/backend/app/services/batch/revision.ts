import { parseISOTimestamp } from '@capacitylens/shared/lib/integrity'

const MAX_TIMESTAMP = Date.parse('9999-12-31T23:59:59.999Z')

/** Returns a valid server timestamp that advances an existing entity revision. */
export function createServerRevision(updatedAt: unknown, now = Date.now()) {
  const current = Math.min(Math.max(Math.trunc(now), 0), MAX_TIMESTAMP)
  const previous = parseISOTimestamp(updatedAt)
  if (previous === null || previous >= MAX_TIMESTAMP) return new Date(current).toISOString()
  return new Date(Math.max(current, previous + 1)).toISOString()
}
