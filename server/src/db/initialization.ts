import type { Db } from "../db";
import { statementCache } from "./statementCache";
/** Persistent "this dataset has been initialised" marker, set on the first write. Unlike
 *  a row count it SURVIVES the user emptying their data, so /api/meta can tell a
 *  genuinely-fresh DB (seed it) from one the user deliberately cleared (don't re-seed) —
 *  mirroring the web app's "storage key present" semantics, where the two diverged. */
export function markInitialized(db: Db): void {
  const cache = statementCache(db);
  if (!cache.markInitialized) {
    cache.markInitialized = db.prepare(`INSERT OR IGNORE INTO _meta (key, value) VALUES ('initialized', '1')`);
  }
  cache.markInitialized.run();
}

export function isInitialized(db: Db): boolean {
  const row = db.prepare(`SELECT value FROM _meta WHERE key = 'initialized'`).get() as { value?: string } | undefined;
  return row?.value === "1";
}
