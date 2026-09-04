import type { Db } from "../db";
import { type Row, toRow, fromRow } from "../rowCodec";
import { resolveTable, assertKnownTable } from "./introspection";
import { cachedTableStatement, statementCache, placeholders } from "./statementCache";
import { tx } from "../txn";
import { markInitialized } from "./initialization";
import { nextServerRevision } from "../revision";
// Insert one row WITHOUT touching the init marker — the primitive the bulk paths
// (insertAll / replaceAccountSlice) loop over so they can mark ONCE at the end instead of
// re-running an `INSERT OR IGNORE INTO _meta` per row.
export function insertRowRaw(db: Db, table: string, obj: Row): void {
  const spec = resolveTable(table);
  const cols = spec.columns.map((c) => c.name);
  const stmt = cachedTableStatement(
    statementCache(db).insertRow,
    table,
    db,
    `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders(cols.length)})`,
  );
  stmt.run(...toRow(spec, obj));
}

export function insertRow(db: Db, table: string, obj: Row): void {
  // The row and persistent first-write marker are one logical write. Without this transaction,
  // SQLite autocommits the row before a later marker failure and the caller observes a rejection
  // for a mutation that actually persisted. tx() uses a savepoint inside an existing transaction.
  tx(db, () => {
    insertRowRaw(db, table, obj);
    markInitialized(db);
  });
}

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
  const cache = statementCache(db);
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
      const updatedAt = nextServerRevision(allocation.updatedAt);
      cache.clearAllocationAttribution.run(updatedAt, allocation.id);
      rewritten.push({ id: allocation.id, createdAt: allocation.createdAt, updatedAt });
    }
  }
  return rewritten;
}

/** Idempotent insert-or-replace by id — the write the sync adapter uses for every
 *  create/update, so replaying a batch after a partial failure can't double-insert
 *  (a re-PUT of an already-written row just overwrites it). */
export function upsertRow(db: Db, table: string, obj: Row): void {
  const spec = resolveTable(table);
  const cols = spec.columns.map((c) => c.name);
  // Exclude id (the conflict key) AND createdAt from the UPDATE: createdAt is immutable
  // (entities.ts calls it "impossible to backfill"), so a re-PUT must never rewrite the
  // original creation time, and a body that omits it must not null it out on update.
  const setCols = cols.filter((c) => c !== "id" && c !== "createdAt");
  const set = setCols.map((c) => `${c} = excluded.${c}`).join(", ");
  tx(db, () => {
    const stmt = cachedTableStatement(
      statementCache(db).upsertRow,
      table,
      db,
      `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders(cols.length)}) ` +
        `ON CONFLICT(id) DO UPDATE SET ${set}`,
    );
    stmt.run(...toRow(spec, obj));
    markInitialized(db);
  });
}

/** Idempotent: deleting an absent id is a no-op (the store's cascade and the DB's
 *  ON DELETE can both target the same row; whichever loses the race must not error). */
export function deleteRow(db: Db, table: string, id: string): void {
  assertKnownTable(table);
  const stmt = cachedTableStatement(statementCache(db).deleteRow, table, db, `DELETE FROM ${table} WHERE id = ?`);
  stmt.run(id);
}

export function getRow(db: Db, table: string, id: string): Row | undefined {
  const spec = resolveTable(table);
  const stmt = cachedTableStatement(statementCache(db).getRow, table, db, `SELECT * FROM ${table} WHERE id = ?`);
  const row = stmt.get(id);
  return row ? fromRow(spec, row) : undefined;
}
