import { emptyAppData, SCHEMA_VERSION, SCOPED_KEYS } from '../types/entities'
import { buildInternalClient, ensureInternalClients } from './internalClient'
import type { AppData } from '../types/entities'

// Turns whatever was persisted (any version, or garbage) into a complete,
// current-shape AppData, plus the IMPORT-path shape guards that decide whether a
// blob is even CapacityLens before we let migrate() near it. This is mostly NORMALIZE-SHAPE
// (coerce every known table to an array via normalize()), not a general version-
// migration engine: there is exactly ONE structural transform (v1 → v2, below). The
// v2 → v3 added `accountId` and needs no separate step here.
// (main.tsx), so older keys are orphaned rather than read, and the import path stamps
// `accountId` on every incoming row (see useStore.importData).

// The known data tables. Derived from SCOPED_KEYS (the single source of truth for the
// scoped tables) plus 'accounts' — adding a new entity to SCOPED_KEYS automatically
// extends this list, so the two can't drift.
export const KNOWN_KEYS: string[] = ['accounts', ...SCOPED_KEYS]

// Legacy table keys that a pre-rename export/blob may carry. `activities` was once `tasks`
// (the Task→Activity rename, schema v5). The IMPORT shape-guards recognise these so a
// legacy file — even one that ONLY carries the renamed table — is accepted (then migrated),
// not mistaken for non-CapacityLens JSON and rejected. The migrate path renames them (migrateV4toV5).
const LEGACY_KEYS: string[] = ['tasks']
const RECOGNISED_KEYS: string[] = [...KNOWN_KEYS, ...LEGACY_KEYS]

/** Refuse data written by a newer app instead of normalizing away fields this build cannot know. */
export class UnsupportedSchemaVersionError extends Error {
  readonly version: number
  constructor(version: number) {
    super(`Schema version ${version} is newer than this app supports (${SCHEMA_VERSION}).`)
    this.name = 'UnsupportedSchemaVersionError'
    this.version = version
  }
}

// Unwrap the object the import shape-guards inspect: either the bare AppData map, or
// the `data` field of a { schemaVersion, data } export. Returns null if not a plain object.
export function importCandidate(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const obj = value as Record<string, unknown>
  return 'data' in obj && obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)
    ? (obj.data as Record<string, unknown>)
    : obj
}

// Recognisable-CapacityLens guard for the IMPORT path: any JSON that parses but isn't
// shaped like CapacityLens data would otherwise be migrated to an EMPTY dataset and
// silently wipe the user's data. (The load path stays lenient on purpose.) Lives in
// migrate.ts so the shape guard and the migrate it gates can't drift — mirrors how
// schedule/diary keep their `looksLike…` guard next to migrate().
export function looksLikeCapacityLens(value: unknown): boolean {
  const candidate = importCandidate(value)
  // Accept legacy keys too (e.g. pre-rename `tasks`) so a valid older export — even one
  // whose only array is a renamed table — passes the guard and reaches migrate().
  return !!candidate && RECOGNISED_KEYS.some((k) => Array.isArray(candidate[k]))
}

// A KNOWN table PRESENT but not an array (e.g. `resources: {…}` from a truncated or
// hand-edited export) is structural damage. migrate()'s asArray() would silently coerce
// it to [], and the "imported N" count — computed post-migrate — would report the lost
// table as success. So REJECT it, matching every other load path,
// which routes the same blob to recovery. Principle: repair within a record, reject a
// structurally broken file. (An ABSENT table is fine — migrate fills it empty.)
export function hasNonArrayKnownTable(value: unknown): boolean {
  const candidate = importCandidate(value)
  // Legacy keys count too: a pre-rename `tasks: {…}` (object, not array) is the same
  // structural damage as a current key — reject it rather than coerce it to [] and lose it.
  return !!candidate && RECOGNISED_KEYS.some((k) => k in candidate && !Array.isArray(candidate[k]))
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

function normalize(data: Partial<AppData> | undefined): AppData {
  if (!data || typeof data !== 'object') return emptyAppData()
  return {
    accounts: asArray(data.accounts),
    disciplines: asArray(data.disciplines),
    resources: asArray(data.resources),
    clients: asArray(data.clients),
    projects: asArray(data.projects),
    phases: asArray(data.phases),
    activities: asArray(data.activities),
    allocations: asArray(data.allocations),
    timeOff: asArray(data.timeOff),
  }
}

// v1 → v2: early resources carried a boolean `isFreelancer`; convert it to the
// richer `employmentType` enum.
function migrateV1toV2(data: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(data.resources)) return data
  const resources = data.resources.map((r) => {
    if (!r || typeof r !== 'object') return r
    const rec = r as Record<string, unknown>
    if ('isFreelancer' in rec && rec.employmentType === undefined) {
      const next: Record<string, unknown> = { ...rec, employmentType: rec.isFreelancer ? 'freelancer' : 'permanent' }
      delete next.isFreelancer
      return next
    }
    return rec
  })
  return { ...data, resources }
}

// v3 → v4: activities gained a required `kind` discriminant (project | internal | repeatable).
// Backfill it from the only signal a pre-v4 row carried: a project-bound one is 'project';
// a project-less ("general") one becomes 'repeatable' — the rename of "general". 'internal'
// is a genuinely new bucket, set explicitly via the UI afterwards, never inferred here.
// NB: this runs BEFORE the v4→v5 rename, so the table is still named `tasks` at this point.
function migrateV3toV4(data: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(data.tasks)) return data
  const tasks = data.tasks.map((t) => {
    if (!t || typeof t !== 'object') return t
    const rec = t as Record<string, unknown>
    if (rec.kind !== undefined) return rec // already v4 (or hand-set) — leave it
    return { ...rec, kind: rec.projectId !== undefined && rec.projectId !== null ? 'project' : 'repeatable' }
  })
  return { ...data, tasks }
}

// v4 → v5: the domain concept "Task" was renamed "Activity". Rename the `tasks` table to
// `activities`, and every allocation's `taskId` foreign key to `activityId`. Pure key
// renames — no field values change (the `kind` strings 'project'|'internal'|'repeatable'
// are unaffected). Idempotent: a blob already on the new shape (no `tasks` key) passes
// through untouched, and an in-progress blob carrying BOTH keys prefers the new one.
function migrateV4toV5(data: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...data }
  // Rename the table: `tasks` → `activities`. Only when a legacy `tasks` exists and the
  // new key isn't already populated (don't clobber an already-migrated `activities`).
  if ('tasks' in next && !('activities' in next)) {
    next.activities = next.tasks
  }
  delete next.tasks
  // Rename the FK on every allocation: `taskId` → `activityId`.
  if (Array.isArray(next.allocations)) {
    next.allocations = next.allocations.map((a) => {
      if (!a || typeof a !== 'object') return a
      const rec = a as Record<string, unknown>
      if (!('taskId' in rec) || 'activityId' in rec) return rec
      const renamed: Record<string, unknown> = { ...rec, activityId: rec.taskId }
      delete renamed.taskId
      return renamed
    })
  }
  return next
}

// v5 → v6: ensure EVERY account carries exactly one built-in "Internal" client (`builtin: true`).
// A real, persisted Client (not a sentinel) so it can own projects and bucket project-less
// activities. IDEMPOTENT: an account that already has a `builtin` client is left alone, so this is
// safe to run repeatedly and on already-migrated / seeded data — a duplicate is never created, and a
// blob that already satisfies the invariant round-trips deep-equal (no client added → no change).
// Detection is by the FLAG, not an id (so it survives import-remap). Runs AFTER the v4→v5 rename, so
// the tables are at their current names; `accounts`/`clients` may be absent on a partial blob — we
// no-op then (an account-less import slice has nothing to attach an Internal client to).
//
// This is the typed `ensureInternalClients` algorithm (see internalClient.ts) re-expressed for the
// RAW, untyped migration blob: a versioned migration runs on a pre-typed `Record<string, unknown>`
// and must stay deterministic (no live clock — a fixed timestamp), so it can't call the typed helper
// directly. The row SHAPE + the "match builtin by flag + accountId" predicate are kept in lockstep by
// using the shared `buildInternalClient` factory for the row literal.
function migrateV5toV6(data: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(data.accounts) || data.accounts.length === 0) return data
  const clients = Array.isArray(data.clients) ? [...data.clients] : []
  const accountsWithBuiltin = new Set(
    clients.flatMap((client) => {
      if (!client || typeof client !== 'object') return []
      const rec = client as Record<string, unknown>
      return rec.builtin === true && typeof rec.accountId === 'string' ? [rec.accountId] : []
    }),
  )
  // Migrated rows are newly created here; a fixed timestamp keeps the migration deterministic.
  const now = '2026-01-01T00:00:00.000Z'
  let added = false
  for (const account of data.accounts) {
    if (!account || typeof account !== 'object') continue
    const accountId = (account as Record<string, unknown>).id
    if (typeof accountId !== 'string' || accountsWithBuiltin.has(accountId)) continue
    clients.push(buildInternalClient(accountId, now))
    accountsWithBuiltin.add(accountId)
    added = true
  }
  return added ? { ...data, clients } : data
}

export function migrate(raw: unknown): AppData {
  if (!raw || typeof raw !== 'object') return emptyAppData()
  const obj = raw as Record<string, unknown>
  const version = typeof obj.schemaVersion === 'number' ? obj.schemaVersion : 0
  if (version > SCHEMA_VERSION) throw new UnsupportedSchemaVersionError(version)

  // Accept either a { schemaVersion, data } wrapper or a bare AppData (legacy).
  let data = ('data' in obj ? obj.data : obj) as Record<string, unknown> | undefined

  if (data && typeof data === 'object' && version < 2) {
    data = migrateV1toV2(data)
  }
  if (data && typeof data === 'object' && version < 4) {
    data = migrateV3toV4(data)
  }
  if (data && typeof data === 'object' && version < 5) {
    data = migrateV4toV5(data)
  }
  if (data && typeof data === 'object' && version < 6) {
    data = migrateV5toV6(data)
  }

  return ensureInternalClients(normalize(data as Partial<AppData> | undefined), '2026-01-01T00:00:00.000Z')
}
