import { InMemoryDemoAdapter } from './InMemoryDemoAdapter'
import { ServerSyncAdapter } from './ServerSyncAdapter'
import { API_BASE, isServerConfigured } from './apiConfig'
import type { PersistenceAdapter } from './PersistenceAdapter'

// The persistence target the app actually boots against. By DEFAULT this is the SQLite-backed
// server via the entity-level ServerSyncAdapter — a drop-in PersistenceAdapter, so nothing else
// in the app changes. An empty API_BASE means the SAME-ORIGIN server (relative `/api`); set
// VITE_CAPACITYLENS_API (e.g. http://localhost:8787) to point at a different origin. The
// in-memory backend is used ONLY in the demo build (VITE_CAPACITYLENS_DEMO=1). The env read
// lives in apiConfig.ts so this wiring just asks isServerConfigured() (mirrors schedule/diary).
export const persistenceAdapter: PersistenceAdapter = isServerConfigured()
  ? new ServerSyncAdapter(API_BASE)
  : new InMemoryDemoAdapter()
