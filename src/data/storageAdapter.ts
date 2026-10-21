import { InMemoryDemoAdapter } from "./InMemoryDemoAdapter";
import { ServerSyncAdapter } from "./ServerSyncAdapter";
import { API_BASE, isServerConfigured } from "./apiConfig";
import type { PersistenceAdapter } from "./PersistenceAdapter";

/** Persistence adapter selected by the build: same-origin or configured server by
 * default, and a temporary in-memory seed only for the explicit demo build.
 */
export const persistenceAdapter: PersistenceAdapter = isServerConfigured()
  ? new ServerSyncAdapter(API_BASE)
  : new InMemoryDemoAdapter();
