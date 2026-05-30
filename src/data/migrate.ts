import { emptyAppData } from '../types/entities'
import type { AppData } from '../types/entities'

// Turns whatever was persisted (any version, or garbage) into a complete,
// current-shape AppData. There is exactly one structural transform today
// (v1 → v2, below); the v2 → v3 bump added `accountId`, which needs no migration
// here — the live key is `floaty/v3` (main.tsx), so older keys are orphaned
// rather than read, and the import path stamps `accountId` on every incoming
// row (see useStore.importData). normalize() then guarantees every array exists.

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
