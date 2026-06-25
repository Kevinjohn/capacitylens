import { STORAGE_KEY_PREFIX } from '@capacitylens/shared/brand'
import { LocalStorageAdapter } from './LocalStorageAdapter'
import { ServerSyncAdapter } from './ServerSyncAdapter'
import { API_BASE, isServerConfigured } from './apiConfig'
import type { PersistenceAdapter } from './PersistenceAdapter'

// The localStorage target. Kept as a named export because the corrupt-data recovery
// UI (StorageRecovery) needs readRaw/clear on the SAME key — methods specific to the
// localStorage backend, not part of the PersistenceAdapter contract. The key is
// versioned (`capacitylens/v3`) — bumping it orphans older data on purpose (see migrate.ts).
// The prefix comes from the brand module so the brand is defined once (shared/src/brand.ts).
export const STORAGE_KEY = `${STORAGE_KEY_PREFIX}v3`

export const storageAdapter = new LocalStorageAdapter(STORAGE_KEY)

// The persistence target the app actually boots against. Setting VITE_CAPACITYLENS_API at
// build/dev time (e.g. http://localhost:8787) flips CapacityLens onto the SQLite-backed
// server via the entity-level ServerSyncAdapter — a drop-in PersistenceAdapter, so
// nothing else in the app changes. Unset → the localStorage backend (default). The env
// read lives in apiConfig.ts so this wiring just asks isServerConfigured() (mirrors
// schedule/diary).
export const persistenceAdapter: PersistenceAdapter = isServerConfigured()
  ? new ServerSyncAdapter(API_BASE)
  : storageAdapter
