import { type Db } from "../db";
/**
 * Per-Db statement caches for the CRUD/read primitives below. Mirrors the WeakMap<Db,...> idiom
 * already used for per-handle state (auth.ts's verificationTablePresence/userTablePresence,
 * txn.ts's activeTransactionModes): a node:sqlite Statement is tied to the Db handle that prepared
 * it, so the cache key is the handle itself and an entry is collected with its handle — tests that
 * open many short-lived in-memory Dbs don't leak. Every cached SQL string is derived ONLY from a
 * table's immutable TABLES spec (never live PRAGMA state), so compiling it once per (Db, table) and
 * reusing the prepared Statement across calls is behavior-preserving. Schema shape only ever
 * changes inside initializeOpenDb (migrations + their ALTERs), and that function drops the
 * handle's entire cache before it returns — a node:sqlite Statement freezes its column set at
 * prepare time, so nothing here is ever cached against a not-yet-final schema.
 */
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

export const statementCaches = new WeakMap<Db, StatementCache>();

export function statementCache(db: Db): StatementCache {
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

/** Lazily prepare and cache one per-table Statement, keyed by table name within `cache`. */
export function cachedTableStatement(
  cache: Map<string, PreparedStatement>,
  table: string,
  db: Db,
  sql: string,
): PreparedStatement {
  let stmt = cache.get(table);
  if (!stmt) {
    stmt = db.prepare(sql);
    cache.set(table, stmt);
  }
  return stmt;
}

export const placeholders = (n: number) => Array.from({ length: n }, () => "?").join(", ");
