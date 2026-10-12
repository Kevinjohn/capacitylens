import type { Db } from "../db";
// Statements belong to their database handle and must be discarded after application migrations change column sets.
// WeakMap ownership permits short-lived handles and their caches to be collected.
type PreparedStatement = ReturnType<Db["prepare"]>;

interface StatementCache {
  readonly insertRow: Map<string, PreparedStatement>;
  readonly upsertRow: Map<string, PreparedStatement>;
  readonly getRow: Map<string, PreparedStatement>;
  readonly deleteRow: Map<string, PreparedStatement>;
  readonly loadStateSelectAll: Map<string, PreparedStatement>;
  readonly scopedSelect: Map<string, PreparedStatement>;
  accountByIdSelect?: PreparedStatement;
  markInitialized?: PreparedStatement;
  accountSummariesSelect?: PreparedStatement;
  attributedAllocationsByActivitySelect?: PreparedStatement;
  clearAllocationAttribution?: PreparedStatement;
}

/** Per-handle cache registry; initializeOpenDb clears it after migrations finalize the schema. */
export const statementCaches = new WeakMap<Db, StatementCache>();

/** Return or create the prepared-statement buckets scoped to one database handle. */
export function createStatementCache(db: Db): StatementCache {
  let cache = statementCaches.get(db);
  if (!cache) {
    cache = {
      insertRow: new Map(),
      upsertRow: new Map(),
      getRow: new Map(),
      deleteRow: new Map(),
      loadStateSelectAll: new Map(),
      scopedSelect: new Map(),
    };
    statementCaches.set(db, cache);
  }
  return cache;
}

interface CreateCachedTableStatementInput {
  cache: Map<string, PreparedStatement>;
  table: string;
  db: Db;
  sql: string;
}

/** Lazily prepare one statement per table in the supplied cache, which initializeOpenDb invalidates after migrations. */
export function createCachedTableStatement({
  cache,
  table,
  db,
  sql,
}: CreateCachedTableStatementInput): PreparedStatement {
  let statement = cache.get(table);
  if (!statement) {
    statement = db.prepare(sql);
    cache.set(table, statement);
  }
  return statement;
}

/**
 * Returns one SQLite placeholder per supplied value for a parameterized `IN` clause.
 */
export const buildPlaceholders = (n: number) => Array.from({ length: n }, () => "?").join(", ");
