import {
  assertAllocationRefs,
  assertDateRange,
  assertResourceExists,
  assertScopedRefs,
} from '@floaty/shared/domain/mutations'
import { sanitizeImportedRecord } from '@floaty/shared/lib/sanitizeImport'
import { isHexColor } from '@floaty/shared/lib/color'
import { cleanText } from '@floaty/shared/lib/strings'
import { SCHEDULING_MODES, SCOPED_KEYS } from '@floaty/shared/types/entities'
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

/**
 * Guard every write path against a missing or non-string id. SQLite TEXT PRIMARY KEY
 * permits NULL, so a POST without an id would store an unaddressable `id: null` row;
 * two such rows can coexist (empirically) and are undeletable by id. Reject early so
 * the constraint never reaches the DB.
 */
export function assertIdPresent(row: Record<string, unknown>): void {
  if (typeof row.id !== 'string' || row.id.trim() === '') {
    throw new ValidationError('id must be a non-empty string.')
  }
}

const FALLBACK_COLOR = '#6366f1'
// Derived from SCOPED_KEYS — the single source of truth — so a new entity added to
// AppData is automatically treated as scoped without an update here.
const isScopedKey = (table: string): table is ScopedEntityKey =>
  (SCOPED_KEYS as string[]).includes(table)

/**
 * Repair the constrained value-level fields of a write body, returning a NEW object
 * (the input is not mutated). Scoped tables delegate to the shared
 * sanitizeImportedRecord; accounts (not a scoped table) get their colour repaired
 * here. A well-formed body from the real client is unchanged — this only bites
 * malformed direct API writes.
 *
 * Also rejects any row whose id is not a non-empty string — the single funnel all
 * write paths flow through, so no path can slip past the NULL-id guard.
 */
export function sanitizeWrite(table: string, row: Record<string, unknown>): Record<string, unknown> {
  assertIdPresent(row)
  const copy = { ...row }
  if (table === 'accounts') {
    copy.color = typeof copy.color === 'string' && isHexColor(copy.color) ? copy.color : FALLBACK_COLOR
    if (typeof copy.name === 'string') copy.name = cleanText(copy.name)
    // schedulingMode is an OPTIONAL enum (absent = 'hourly'). Drop a junk value rather
    // than persisting a mode the scheduler's hourly/days/blocks switch can't handle — the
    // one enum a direct /api/accounts write would otherwise slip past every other guard.
    if (copy.schedulingMode !== undefined && !SCHEDULING_MODES.includes(copy.schedulingMode as never)) {
      delete copy.schedulingMode
    }
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
