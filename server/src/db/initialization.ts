import type { Db } from "../db";
import { createStatementCache } from "./statementCache";
/** Records persistent initialization so deliberate emptying of the dataset never triggers reseeding. */
export function markInitialized(db: Db): void {
  const cache = createStatementCache(db);
  cache.markInitialized ??= db.prepare(`INSERT OR IGNORE INTO _meta (key, value) VALUES ('initialized', '1')`);
  cache.markInitialized.run();
}

/** Returns whether the persistent dataset initialization marker exists. */
export function isInitialized(db: Db): boolean {
  const row = db.prepare(`SELECT value FROM _meta WHERE key = 'initialized'`).get() as { value?: string } | undefined;
  return row?.value === "1";
}
