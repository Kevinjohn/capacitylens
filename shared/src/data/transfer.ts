// The CapacityLens shape guards (looksLikeCapacityLens / hasNonArrayKnownTable) live in migrate.ts —
// next to the migrate they gate, so the "is this even CapacityLens" check and the transform it
// protects can't drift (mirrors schedule/diary). Imported back here for the parse path.
import { importCandidate, KNOWN_KEYS, migrate, looksLikeCapacityLens, hasNonArrayKnownTable } from './migrate'
import { EXPORT_SCHEMA_VERSION } from '../types/entities'
import type { AppData, PersistedState } from '../types/entities'

// Whole-dataset export/import — a one-click backup and a cheap way to hand a
// snapshot to a friend before the shared backend exists. Import reuses migrate()
// so legacy / partial / slightly-off files are tolerated rather than rejected.

export function serializeData(data: AppData): string {
  const state: PersistedState = { schemaVersion: EXPORT_SCHEMA_VERSION, data }
  return JSON.stringify(state, null, 2)
}

// Guard against a JSON bomb / runaway file: a real agency dataset is thousands of
// rows, not millions. Refuse anything wildly out of range rather than locking the
// main thread (client import) or the server event loop trying to remap it.
//
// NOT redundant with the 5 MiB byte caps (ImportExport's client file-size check and
// the server's request BODY_LIMIT): those bound the payload SIZE, this bounds the
// record COUNT — a different axis. Real exports run ~100–400 bytes/record, so a 5 MiB
// file holds well under this cap and the byte cap fires first there. But `parseData`
// also runs on the server's POST /api/import, where a HOSTILE body of many near-empty
// records (`{}` compacts to ~3 bytes) fits well over a million inside the 5 MiB
// BODY_LIMIT — so this count cap is the live backstop that actually bites on that path.
// (I.e. the error is reachable, not dead code; keep it.)
export const MAX_IMPORT_RECORDS = 200_000

export function parseData(json: string): AppData {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (e) {
    // Forward the SyntaxError as `cause` so the parse failure's chain survives behind our friendly
    // message (ESLint preserve-caught-error enforces this for re-thrown native errors).
    throw new Error("That file isn't valid JSON.", { cause: e })
  }
  if (!looksLikeCapacityLens(raw)) {
    throw new Error('This file is not CapacityLens data.')
  }
  // Reject a structurally damaged file (a known table present but not a list) rather than
  // letting migrate() silently coerce it to [] and under-report the loss. See above.
  if (hasNonArrayKnownTable(raw)) {
    throw new Error('This file is damaged: a data table is not a list. Nothing was imported.')
  }
  const candidate = importCandidate(raw)!
  const rawTotal = [...KNOWN_KEYS, 'tasks'].reduce(
    (n, key) => n + (Array.isArray(candidate[key]) ? candidate[key].length : 0),
    0,
  )
  if (rawTotal > MAX_IMPORT_RECORDS) {
    throw new Error(`This file has too many records (${rawTotal.toLocaleString()}).`)
  }
  const data = migrate(raw)
  // NOTE: this `total` counts EVERY table on AppData (it includes `accounts`), because here we're
  // gating the FILE — its size and emptiness — not the per-account import. The importer
  // (remapAndValidateImport) later counts only the SCOPED_KEYS it actually brings into the active
  // account, so its "imported N" can be smaller than this total by exactly the accounts array.
  // The two counts answer different questions on purpose; don't "reconcile" them into one.
  const total = Object.values(data).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0)
  if (total > MAX_IMPORT_RECORDS) {
    throw new Error(`This file has too many records (${total.toLocaleString()}).`)
  }
  // A CapacityLens-shaped file that migrates to ZERO records would, if imported, replace the
  // active company's slice with nothing — a silent wipe. Refuse it: importing an empty
  // file is never the intent (delete is the explicit path for clearing data).
  if (total === 0) {
    throw new Error('This file contains no CapacityLens records.')
  }
  return data
}
