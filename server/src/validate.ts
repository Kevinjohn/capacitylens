import {
  assertAllocationRefs,
  assertDateRange,
  assertResourceExists,
  assertResourceKindAllowsDependents,
  assertScopedRefs,
} from '@capacitylens/shared/domain/mutations'
import { sanitizeImportedRecord, sanitizeAccount } from '@capacitylens/shared/lib/sanitizeImport'
import {
  INTERNAL_CLIENT_COLOR,
  INTERNAL_CLIENT_NAME,
  wouldAddSecondBuiltin,
} from '@capacitylens/shared/data/internalClient'
import { snapToPresetColor } from '@capacitylens/shared/lib/color'
import { cleanText } from '@capacitylens/shared/lib/strings'
import { isLifecycleEntityKey } from '@capacitylens/shared/domain/lifecycle'
import { SCHEDULING_MODES, SCOPED_KEYS } from '@capacitylens/shared/types/entities'
import type { AppData, ScopedEntityKey } from '@capacitylens/shared/types/entities'
import { TABLES } from './tables'
import { pinGatedFields, type SanitizeWriteOptions } from './fieldPolicy'

// SanitizeWriteOptions is owned by fieldPolicy.ts (the single source of role-gated field policy);
// re-exported here so existing importers (app.ts) keep their `from './validate'` import unchanged.
export type { SanitizeWriteOptions } from './fieldPolicy'

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
  if (
    typeof row.id !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(row.id)
  ) {
    throw new ValidationError(
      'id must be 1–128 URL-safe characters, begin with a letter or number, and contain only letters, numbers, dot, underscore, tilde or hyphen.',
    )
  }
}

// Derived from SCOPED_KEYS — the single source of truth — so a new entity added to
// AppData is automatically treated as scoped without an update here.
const isScopedKey = (table: string): table is ScopedEntityKey =>
  (SCOPED_KEYS as string[]).includes(table)

/** Copy only columns accepted by the table codec. Generic request bodies are untrusted; keeping
 * extra properties would leak them into audit metadata and response echoes even though SQLite
 * silently ignores them. */
export function acceptedWriteFields(
  table: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const spec = TABLES[table]
  if (!spec) return {}
  const accepted = new Set(spec.columns.map((column) => column.name))
  return Object.fromEntries(Object.entries(row).filter(([key]) => accepted.has(key)))
}

export function acceptedFieldNames(table: string, row: unknown): string[] {
  return row && typeof row === 'object'
    ? Object.keys(acceptedWriteFields(table, row as Record<string, unknown>))
    : []
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
  const copy = acceptedWriteFields(table, row)
  if (table === 'accounts') {
    // POLICY: a non-preset colour snaps to its NEAREST palette preset (shared/lib/color's
    // snapToPresetColor — the SAME mapper the client uses and the one-time
    // snap-legacy-account-colors migration ran), not a fixed fallback purple. Before this, ANY
    // stored colour outside the (then-current) preset set was replaced with one fixed hex on
    // every write, so a legacy account's colour — or any hex a hand-crafted request supplied —
    // would silently flip to that one colour the next time the row was touched. See DECISIONS.md.
    copy.color = snapToPresetColor(copy.color)
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
    // P1.6 field-confidentiality PINS (note-erasure guard + private-name guard): same PIN mechanism
    // as the tombstones above, but the WHICH-fields-are-gated knowledge is single-sourced in
    // GATED_FIELD_POLICIES (fieldPolicy.ts) so this write-pin can never drift from the read redaction
    // and export-include sites. When the writer's role cannot see a gated field (readSlice redacted
    // it from every row they ever received), their write body is missing that key BY CONSTRUCTION —
    // pin it to the stored value on an UPDATE, strip it on a CREATE. A writer who CAN see the field
    // (owner/admin, or auth OFF) passes through untouched.
    pinGatedFields(table, cleaned, existing, opts)
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
export function validateWrite(
  state: AppData,
  table: string,
  row: Record<string, unknown>,
  existing?: Record<string, unknown>,
): void {
  if (isLifecycleEntityKey(table) && typeof existing?.deletedAt === 'string') {
    throw new ValidationError('Soft-deleted records can only be changed through lifecycle endpoints.')
  }
  const accountId = row.accountId as string
  const deletedParent = (() => {
    if (table === 'projects') return state.clients.find((parent) => parent.id === row.clientId && parent.accountId === accountId)
    if (table === 'phases' || table === 'activities') return state.projects.find((parent) => parent.id === row.projectId && parent.accountId === accountId)
    if (table === 'allocations' || table === 'timeOff') return state.resources.find((parent) => parent.id === row.resourceId && parent.accountId === accountId)
    return undefined
  })()
  if (deletedParent?.deletedAt) {
    throw new ValidationError('Records beneath a soft-deleted parent cannot be changed through generic endpoints.')
  }
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
    if (existing?.builtin === true) {
      if (
        row.builtin !== true ||
        row.name !== INTERNAL_CLIENT_NAME ||
        row.color !== INTERNAL_CLIENT_COLOR
      ) {
        throw new ValidationError('The built-in Internal client cannot be modified.')
      }
    }
    if (row.builtin === true && (row.name !== INTERNAL_CLIENT_NAME || row.color !== INTERNAL_CLIENT_COLOR)) {
      throw new ValidationError('The built-in Internal client has a fixed name and colour.')
    }
    if (row.builtin === true && wouldAddSecondBuiltin(state.clients, row.accountId as string, row.id as string)) {
      throw new ValidationError('This company already has its built-in Internal client.')
    }
    return
  }
  try {
    if (table === 'accounts') {
      if (typeof row.name !== 'string' || row.name.trim().length === 0) {
        throw new ValidationError('Company name is required.')
      }
      return
    }
    if (table === 'disciplines') {
      // No outbound foreign keys to validate (accounts are top-level; disciplines only
      // carry accountId, which the DB's FK enforces).
      return
    }
    if (SCOPED_REF_TABLES.includes(table as ScopedEntityKey)) {
      assertScopedRefs(state, accountId, table as ScopedEntityKey, row, existing)
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
      assertAllocationRefs(
        state,
        accountId,
        row.resourceId as string,
        row.activityId as string,
        row.hoursPerDay as number,
        existing as never,
      )
      assertDateRange(row.startDate as string, row.endDate as string)
      return
    }
    if (table === 'timeOff') {
      assertResourceExists(state, accountId, row.resourceId as string, existing as never)
      assertDateRange(row.startDate as string, row.endDate as string)
      return
    }
  } catch (e) {
    // The shared asserts throw plain Errors; tag them as caller-fault so the route
    // returns 400, not 500. Forward the original as `cause` so the full chain survives the re-tag.
    throw new ValidationError(e instanceof Error ? e.message : String(e), { cause: e })
  }
}
