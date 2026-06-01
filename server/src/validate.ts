import {
  assertAllocationRefs,
  assertDateRange,
  assertResourceExists,
  assertScopedRefs,
} from '@floaty/shared/domain/mutations'
import { sanitizeImportedRecord } from '@floaty/shared/lib/sanitizeImport'
import { isHexColor } from '@floaty/shared/lib/color'
import { cleanText } from '@floaty/shared/lib/strings'
import type { AppData, ScopedEntityKey } from '@floaty/shared/types/entities'

// The server is the integrity boundary for direct API writes. Two layers, both
// reusing the SAME shared domain-core the client uses (so server rules can't drift
// from client rules):
//   1. sanitizeWrite — repair value-level fields (enums / colour / hours /
//      workingDays) exactly as the import path does, so a hand-crafted request can't
//      persist a junk enum, non-hex colour, or NaN/negative hours.
//   2. validateWrite — referential integrity + date ranges, throwing ValidationError
//      (mapped to HTTP 400 by the caller; an unexpected throw becomes 500).

/** A caller-fault error (bad request body) — mapped to HTTP 400. Distinct from an
 *  unexpected server/db error, which must surface as 500. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

const FALLBACK_COLOR = '#6366f1'
const isScopedKey = (table: string): table is ScopedEntityKey =>
  ['disciplines', 'resources', 'clients', 'projects', 'phases', 'tasks', 'allocations', 'timeOff'].includes(table)

/**
 * Repair the constrained value-level fields of a write body, returning a NEW object
 * (the input is not mutated). Scoped tables delegate to the shared
 * sanitizeImportedRecord; accounts (not a scoped table) get their colour repaired
 * here. A well-formed body from the real client is unchanged — this only bites
 * malformed direct API writes.
 */
export function sanitizeWrite(table: string, row: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...row }
  if (table === 'accounts') {
    copy.color = typeof copy.color === 'string' && isHexColor(copy.color) ? copy.color : FALLBACK_COLOR
    if (typeof copy.name === 'string') copy.name = cleanText(copy.name)
    return copy
  }
  if (isScopedKey(table)) return sanitizeImportedRecord(table, copy)
  return copy
}

const SCOPED_REF_TABLES: ScopedEntityKey[] = ['projects', 'phases', 'tasks', 'resources']

/**
 * Referential-integrity + date-range validation for a write. `row` is the full
 * entity (it carries id/accountId/timestamps). Throws ValidationError on any
 * violation so the route can map it to 400 rather than leaking it as a 500.
 */
export function validateWrite(state: AppData, table: string, row: Record<string, unknown>): void {
  try {
    if (table === 'accounts' || table === 'clients' || table === 'disciplines') {
      // No outbound foreign keys to validate (accounts are top-level; clients and
      // disciplines only carry accountId, which the DB's FK enforces).
      return
    }
    const accountId = row.accountId as string
    if (SCOPED_REF_TABLES.includes(table as ScopedEntityKey)) {
      assertScopedRefs(state, accountId, table as ScopedEntityKey, row)
      return
    }
    if (table === 'allocations') {
      assertAllocationRefs(state, accountId, row.resourceId as string, row.taskId as string)
      assertDateRange(row.startDate as string, row.endDate as string)
      return
    }
    if (table === 'timeOff') {
      assertResourceExists(state, accountId, row.resourceId as string)
      assertDateRange(row.startDate as string, row.endDate as string)
      return
    }
  } catch (e) {
    // The shared asserts throw plain Errors; tag them as caller-fault so the route
    // returns 400, not 500.
    throw new ValidationError(e instanceof Error ? e.message : String(e))
  }
}
