import { emptyAppData, SCOPED_KEYS } from '../types/entities'
import type { AppData } from '../types/entities'

// Turns whatever was persisted (any version, or garbage) into a complete,
// current-shape AppData, plus the IMPORT-path shape guards that decide whether a
// blob is even Floaty before we let migrate() near it. This is mostly NORMALIZE-SHAPE
// (coerce every known table to an array via normalize()), not a general version-
// migration engine: there is exactly ONE structural transform (v1 → v2, below). The
// v2 → v3 bump added `accountId` and needs NO step here — the live key is `floaty/v3`
// (main.tsx), so older keys are orphaned rather than read, and the import path stamps
// `accountId` on every incoming row (see useStore.importData).

// The known data tables. Derived from SCOPED_KEYS (the single source of truth for the
// scoped tables) plus 'accounts' — adding a new entity to SCOPED_KEYS automatically
// extends this list, so the two can't drift.
export const KNOWN_KEYS: string[] = ['accounts', ...SCOPED_KEYS]

// Unwrap the object the import shape-guards inspect: either the bare AppData map, or
// the `data` field of a { schemaVersion, data } export. Returns null if not a plain object.
export function importCandidate(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const obj = value as Record<string, unknown>
  return 'data' in obj && obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)
    ? (obj.data as Record<string, unknown>)
    : obj
}

// Recognisable-Floaty guard for the IMPORT path: any JSON that parses but isn't
// shaped like Floaty data would otherwise be migrated to an EMPTY dataset and
// silently wipe the user's data. (The load path stays lenient on purpose.) Lives in
// migrate.ts so the shape guard and the migrate it gates can't drift — mirrors how
// schedule/diary keep their `looksLike…` guard next to migrate().
export function looksLikeFloaty(value: unknown): boolean {
  const candidate = importCandidate(value)
  return !!candidate && KNOWN_KEYS.some((k) => Array.isArray(candidate[k]))
}

// A KNOWN table PRESENT but not an array (e.g. `resources: {…}` from a truncated or
// hand-edited export) is structural damage. migrate()'s asArray() would silently coerce
// it to [], and the "imported N" count — computed post-migrate — would report the lost
// table as success. So REJECT it, matching the localStorage LOAD path (hasNonArrayTable),
// which routes the same blob to recovery. Principle: repair within a record, reject a
// structurally broken file. (An ABSENT table is fine — migrate fills it empty.)
export function hasNonArrayKnownTable(value: unknown): boolean {
  const candidate = importCandidate(value)
  return !!candidate && KNOWN_KEYS.some((k) => k in candidate && !Array.isArray(candidate[k]))
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
    tasks: asArray(data.tasks),
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

export function migrate(raw: unknown): AppData {
  if (!raw || typeof raw !== 'object') return emptyAppData()
  const obj = raw as Record<string, unknown>
  const version = typeof obj.schemaVersion === 'number' ? obj.schemaVersion : 0

  // Accept either a { schemaVersion, data } wrapper or a bare AppData (legacy).
  let data = ('data' in obj ? obj.data : obj) as Record<string, unknown> | undefined

  if (data && typeof data === 'object' && version < 2) {
    data = migrateV1toV2(data)
  }

  return normalize(data as Partial<AppData> | undefined)
}
