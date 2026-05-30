import { migrate } from './migrate'
import { SCHEMA_VERSION } from '../types/entities'
import type { AppData, PersistedState } from '../types/entities'

// Whole-dataset export/import — a one-click backup and a cheap way to hand a
// snapshot to a friend before the shared backend exists. Import reuses migrate()
// so legacy / partial / slightly-off files are tolerated rather than rejected.

export function serializeData(data: AppData): string {
  const state: PersistedState = { schemaVersion: SCHEMA_VERSION, data }
  return JSON.stringify(state, null, 2)
}

const KNOWN_KEYS = ['accounts', 'disciplines', 'resources', 'clients', 'projects', 'phases', 'tasks', 'allocations', 'timeOff']

// Recognisable-Floaty guard for the IMPORT path: any JSON that parses but isn't
// shaped like Floaty data would otherwise be migrated to an EMPTY dataset and
// silently wipe the user's data. (The load path stays lenient on purpose.)
function looksLikeFloaty(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const obj = value as Record<string, unknown>
  const candidate =
    'data' in obj && obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)
      ? (obj.data as Record<string, unknown>)
      : obj
  return KNOWN_KEYS.some((k) => Array.isArray(candidate[k]))
}

export function parseData(json: string): AppData {
  const raw: unknown = JSON.parse(json)
  if (!looksLikeFloaty(raw)) {
    throw new Error('This file is not Floaty data.')
  }
  return migrate(raw)
}
