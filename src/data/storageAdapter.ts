import { LocalStorageAdapter } from './LocalStorageAdapter'
import { ServerSyncAdapter } from './ServerSyncAdapter'
import type { PersistenceAdapter } from './PersistenceAdapter'

// The localStorage target. Kept as a named export because the corrupt-data recovery
// UI (StorageRecovery) needs readRaw/clear on the SAME key — methods specific to the
// localStorage backend, not part of the PersistenceAdapter contract. The key is
// versioned — bumping it orphans older data on purpose (see migrate.ts).
export const STORAGE_KEY = 'floaty/v3'

export const storageAdapter = new LocalStorageAdapter(STORAGE_KEY)

// The persistence target the app actually boots against. Setting VITE_FLOATY_API at
// build/dev time (e.g. http://localhost:8787) flips Floaty onto the SQLite-backed
// server via the entity-level ServerSyncAdapter — a drop-in PersistenceAdapter, so
// nothing else in the app changes. Unset → the localStorage backend (default).
const apiBaseUrl = import.meta.env.VITE_FLOATY_API

export const persistenceAdapter: PersistenceAdapter = apiBaseUrl
  ? new ServerSyncAdapter(apiBaseUrl)
  : storageAdapter
