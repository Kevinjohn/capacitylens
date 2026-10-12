import type { Db } from "../db";
import { toRow, fromRow } from "../rowCodec";
import type { Row } from "../rowCodec";
import { resolveTable, assertKnownTable } from "./introspection";
import { createCachedTableStatement, createStatementCache, buildPlaceholders } from "./statementCache";
import { tx } from "../txn";
import { markInitialized } from "./initialization";
import { createServerRevision } from "../revision";
// Insert one row without touching the init marker, the primitive the bulk paths
// (insertAll / replaceAccountSlice) loop over so they can mark once at the end instead of
// re-running an `INSERT OR IGNORE INTO _meta` per row.
/** Inserts one validated application row without changing the initialization marker.
 * Bulk callers must mark initialization only after their complete write succeeds.
 */
export function insertRowRaw(db: Db, table: string, row: Row): void {
  const spec = resolveTable(table);
  const columns = spec.columns.map((c) => c.name);
  const statement = createCachedTableStatement({
    cache: createStatementCache(db).insertRow,
    table,
    db,
    sql: `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${buildPlaceholders(columns.length)})`,
  });
  statement.run(...toRow(spec, row));
}

/** Inserts one row and its initialization marker atomically, using a savepoint inside an existing transaction. */
export function insertRow(db: Db, table: string, row: Row): void {
  // The row and persistent first-write marker are one logical write. Without this transaction,
  // SQLite autocommits the row before a later marker failure and the caller observes a rejection
  // for a mutation that actually persisted. tx() uses a savepoint inside an existing transaction.
  tx(db, () => {
    insertRowRaw(db, table, row);
    markInitialized(db);
  });
}

/**
 * Contains the allocation ID and revisions returned when a write rewrites allocation data.
 */
export interface RewrittenAllocationRevision {
  id: string;
  createdAt: string;
  updatedAt: string;
}

/** The single allocation-attribution clearing mechanism. Activity write paths supply ids collected at flip time. */
export function clearAllocationAttributionForActivities(
  db: Db,
  activityIds: ReadonlySet<string>,
): RewrittenAllocationRevision[] {
  const cache = createStatementCache(db);
  cache.attributedAllocationsByActivitySelect ??= db.prepare(
    "SELECT id, createdAt, updatedAt FROM allocations WHERE activityId = ? AND projectId IS NOT NULL",
  );
  cache.clearAllocationAttribution ??= db.prepare(
    "UPDATE allocations SET projectId = NULL, updatedAt = ? WHERE id = ?",
  );
  const rewritten: RewrittenAllocationRevision[] = [];
  for (const activityId of activityIds) {
    const attributed = cache.attributedAllocationsByActivitySelect.all(activityId) as Array<{
      id: string;
      createdAt: string;
      updatedAt: unknown;
    }>;
    for (const allocation of attributed) {
      const updatedAt = createServerRevision(allocation.updatedAt);
      cache.clearAllocationAttribution.run(updatedAt, allocation.id);
      rewritten.push({ id: allocation.id, createdAt: allocation.createdAt, updatedAt });
    }
  }
  return rewritten;
}

/** Upserts by ID while preserving createdAt and marking initialization atomically.
 * The caller must authorize and validate the row before invoking this storage primitive.
 */
export function upsertRow(db: Db, table: string, row: Row): void {
  const spec = resolveTable(table);
  const columns = spec.columns.map((c) => c.name);
  // Exclude id (the conflict key) and createdAt from the UPDATE: createdAt is immutable
  // (entities.ts calls it "impossible to backfill"), so a re-PUT must never rewrite the
  // original creation time, and a body that omits it must not null it out on update.
  const setCols = columns.filter((c) => c !== "id" && c !== "createdAt");
  const set = setCols.map((c) => `${c} = excluded.${c}`).join(", ");
  tx(db, () => {
    const statement = createCachedTableStatement({
      cache: createStatementCache(db).upsertRow,
      table,
      db,
      sql:
        `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${buildPlaceholders(columns.length)}) ` +
        `ON CONFLICT(id) DO UPDATE SET ${set}`,
    });
    statement.run(...toRow(spec, row));
    markInitialized(db);
  });
}

/** Idempotent: deleting an absent id is a no-op (the store's cascade and the DB's
 * ON DELETE can both target the same row; whichever loses the race must not error). */
export function deleteRow(db: Db, table: string, id: string): void {
  assertKnownTable(table);
  const statement = createCachedTableStatement({
    cache: createStatementCache(db).deleteRow,
    table,
    db,
    sql: `DELETE FROM ${table} WHERE id = ?`,
  });
  statement.run(id);
}

/**
 * Reads row from its authoritative source so decisions use persisted state.
 */
export function getRow(db: Db, table: string, id: string): Row | null {
  const spec = resolveTable(table);
  const statement = createCachedTableStatement({
    cache: createStatementCache(db).getRow,
    table,
    db,
    sql: `SELECT * FROM ${table} WHERE id = ?`,
  });
  const row = statement.get(id);
  return row ? fromRow(spec, row) : null;
}
