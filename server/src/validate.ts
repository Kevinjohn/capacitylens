import {
  assertAllocationRefs,
  assertDateRange,
  assertResourceExists,
  assertResourceKindAllowsDependents,
  assertScopedRefs,
} from '@floaty/shared/domain/mutations'
import { sanitizeImportedRecord, sanitizeAccount } from '@floaty/shared/lib/sanitizeImport'
import { wouldAddSecondBuiltin } from '@floaty/shared/data/internalClient'
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
  // Accepts ErrorOptions so a re-tag from a catch can forward `{ cause }` and preserve the full
  // chain (not just the message) — see validateWrite below.
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
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
    sanitizeAccount(copy)
    return copy
  }
  if (isScopedKey(table)) return sanitizeImportedRecord(table, copy)
  return copy
}

const SCOPED_REF_TABLES: ScopedEntityKey[] = ['projects', 'phases', 'activities', 'resources']

/**
 * Referential-integrity + date-range validation for a write. `row` is the full
 * entity (it carries id/accountId/timestamps). Throws ValidationError on any
 * violation so the route can map it to 400 rather than leaking it as a 500.
 */
export function validateWrite(state: AppData, table: string, row: Record<string, unknown>): void {
  // A client carries no outbound FK, but the built-in Internal client is a SINGLETON: exactly one per
  // account. This is the SERVER-REJECT enforcement point (3) of the single-Internal invariant — the
  // direct API is the integrity boundary and the only write path that CAN set `builtin: true`. The
  // other two points (store strip = public CRUD; import fold = bulk replace can't reject) are
  // documented beside `wouldAddSecondBuiltin` in shared/src/data/internalClient.ts. Updating the SAME
  // builtin (matching id) is fine. (Thrown directly, outside the try below, so it isn't redundantly
  // re-tagged — it's already a ValidationError → 400.)
  if (table === 'clients') {
    if (row.builtin === true && wouldAddSecondBuiltin(state.clients, row.accountId as string, row.id as string)) {
      throw new ValidationError('This company already has its built-in Internal client.')
    }
    return
  }
  try {
    if (table === 'accounts' || table === 'disciplines') {
      // No outbound foreign keys to validate (accounts are top-level; disciplines only
      // carry accountId, which the DB's FK enforces).
      return
    }
    const accountId = row.accountId as string
    if (SCOPED_REF_TABLES.includes(table as ScopedEntityKey)) {
      assertScopedRefs(state, accountId, table as ScopedEntityKey, row)
      // `row` is the full merged entity (PUT carries the whole row; PATCH merges {...existing, ...body}),
      // so `row.kind` is the kind the resource WILL have. Reject a flip-to-external that would orphan
      // existing loaded work / time-off — `state` is loaded BEFORE the write, so it still holds those
      // dependents. Same shared assert the store's updateResource calls, so the two can't drift. A no-op
      // for non-resource tables and for any write that doesn't make the resource external.
      if (table === 'resources') {
        assertResourceKindAllowsDependents(state, accountId, row.id as string, row.kind)
      }
      return
    }
    if (table === 'allocations') {
      assertAllocationRefs(state, accountId, row.resourceId as string, row.activityId as string, row.hoursPerDay as number)
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
    // returns 400, not 500. Forward the original as `cause` so the full chain survives the re-tag.
    throw new ValidationError(e instanceof Error ? e.message : String(e), { cause: e })
  }
}
