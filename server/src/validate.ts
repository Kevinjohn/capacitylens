import {
  assertAllocationRefs,
  assertDateRange,
  assertResourceExists,
  assertResourceKindAllowsDependents,
  assertScopedRefs,
} from '@capacitylens/shared/domain/mutations'
import { sanitizeImportedRecord, sanitizeAccount } from '@capacitylens/shared/lib/sanitizeImport'
import { wouldAddSecondBuiltin } from '@capacitylens/shared/data/internalClient'
import { isHexColor } from '@capacitylens/shared/lib/color'
import { cleanText } from '@capacitylens/shared/lib/strings'
import { isLifecycleEntityKey } from '@capacitylens/shared/domain/lifecycle'
import { SCHEDULING_MODES, SCOPED_KEYS } from '@capacitylens/shared/types/entities'
import type { AppData, ScopedEntityKey } from '@capacitylens/shared/types/entities'

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

/** Caller-context options for {@link sanitizeWrite} — facts about the WRITER that the row body
 *  alone cannot carry, so field-level pinning rules can run at the same single funnel the
 *  tombstone pin uses (not as per-route hacks). */
export interface SanitizeWriteOptions {
  /**
   * P1.6 write-side counterpart of the read redaction: `false` when the caller's role may NOT see
   * the time-off `note` (the same `canSeeTimeOffNote` rule readSlice applies; auth OFF ⇒ always
   * `true`). A note-blind writer round-trips rows the server REDACTED — their PUT body has no
   * `note` key — so without a pin, upsertRow would store NULL (rowCodec: absent optional → SQL
   * NULL) and silently ERASE a note the writer never saw. Defaults to `true` (visible), which is
   * byte-identical to the pre-option behaviour, so callers writing tables other than `timeOff`
   * need not pass it.
   */
  canSeeTimeOffNote?: boolean
}

/**
 * Repair the constrained value-level fields of a write body, returning a NEW object
 * (the input is not mutated). Scoped tables delegate to the shared
 * sanitizeImportedRecord; accounts (not a scoped table) get their colour repaired
 * here. A well-formed body from the real client is unchanged — this only bites
 * malformed direct API writes.
 *
 * Also rejects any row whose id is not a non-empty string — the single funnel all
 * write paths flow through, so no path can slip past the NULL-id guard.
 *
 * `existing` is the currently-stored row (from getRow) on an UPDATE — PUT/PATCH/batch pass it so
 * the lifecycle tombstones (and, for a note-blind writer, the time-off `note`) can be PINNED to
 * what's on disk (see the scoped branch); it is undefined on a CREATE (POST), which is why a new
 * row always starts with its tombstones stripped (active).
 *
 * `opts` carries writer-context facts (see {@link SanitizeWriteOptions}); omit it entirely for
 * tables the options don't apply to.
 */
export function sanitizeWrite(
  table: string,
  row: Record<string, unknown>,
  existing?: Record<string, unknown>,
  opts: SanitizeWriteOptions = {},
): Record<string, unknown> {
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
  if (isScopedKey(table)) {
    const cleaned = sanitizeImportedRecord(table, copy)
    // Lifecycle tombstones (archivedAt/deletedAt, P2.1) are owned ONLY by the four dedicated
    // archive/unarchive/delete/purge routes, which build rows via the pure lifecycle transitions +
    // replaceAccountSlice and NEVER pass through sanitizeWrite. So across every GENERIC write
    // (POST/PUT/PATCH/batch) they are IMMUTABLE in BOTH directions — PIN them to whatever is already
    // stored (`existing`), ignoring the body:
    //   • a crafted body can't SET a tombstone on an active row (which would bypass the
    //     archived-before-delete interlock AND, for resources, the obfuscateResource name scrub,
    //     leaving an un-scrubbed "deleted" row a back-dated deletedAt makes instantly purgeable); and
    //   • an unrelated field-edit (e.g. PATCH {color}) can't CLEAR an existing tombstone — the PATCH
    //     merges `existing` (carrying its real archivedAt) and THEN this funnel runs, so a blind strip
    //     would let upsertRow NULL the column and silently RESURRECT an archived/soft-deleted row to
    //     active. There is NO un-delete route anywhere (canUnarchive rejects a 'deleted' tombstone),
    //     so this would manufacture a capability the product deliberately has none of.
    // On a CREATE (existing === undefined) both fall through to the strip, so new rows start active.
    // The IMPORT path is untouched: it uses sanitizeImportedRecord directly (not sanitizeWrite), so a
    // legitimate export round-trips its tombstones. (accounts/disciplines carry no tombstones.)
    if (isLifecycleEntityKey(table)) {
      if (typeof existing?.archivedAt === 'string') cleaned.archivedAt = existing.archivedAt
      else delete cleaned.archivedAt
      if (typeof existing?.deletedAt === 'string') cleaned.deletedAt = existing.deletedAt
      else delete cleaned.deletedAt
    }
    // P1.6 note-erasure guard (same PIN mechanism as the tombstones above): when the writer's role
    // cannot see the time-off `note` (readSlice redacted it from every row they ever received),
    // their write body is note-less BY CONSTRUCTION — so pin `note` to the stored value on an
    // UPDATE, and strip it on a CREATE (existing === undefined ⇒ nothing to preserve; a note-blind
    // writer also can't legitimately AUTHOR a note they'd never be able to read back). A writer who
    // CAN see the note (owner/admin, or auth OFF) passes through untouched, so they can still
    // change or clear it.
    if (table === 'timeOff' && opts.canSeeTimeOffNote === false) {
      if (typeof existing?.note === 'string') cleaned.note = existing.note
      else delete cleaned.note
    }
    return cleaned
  }
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
    // The built-in Internal client is a per-account SINGLETON, and the direct API is the only write
    // path that can set `builtin`. Two symmetric server-side guards:
    //  (a) never ADD a second builtin to an account (wouldAddSecondBuiltin), and
    //  (b) never UN-FLAG the existing builtin — a crafted PATCH `{builtin:false}` merges to `builtin`
    //      absent (sanitizeImportedRecord drops a non-true builtin) and would otherwise strip the
    //      singleton, orphaning the derived "project-less activities bucket under Internal" association
    //      until the next boot backfill re-creates one. The web store never sends this (Draft<Client>
    //      excludes builtin); it is purely a direct/crafted-request guard. Updating the SAME builtin
    //      (matching id, builtin still true) is fine.
    const existing = state.clients.find((c) => c.id === row.id)
    if (existing?.builtin === true && row.builtin !== true) {
      throw new ValidationError('The built-in Internal client cannot be converted to a regular client.')
    }
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
