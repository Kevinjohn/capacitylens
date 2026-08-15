import { createHash } from "node:crypto";
import type { Db } from "./db";

/** Immutable database-v18 schema component. */
export const SYNC_ORDERING_SQL = `
CREATE TABLE IF NOT EXISTS capacitylens_sync_sessions (
  sessionId TEXT NOT NULL PRIMARY KEY,
  lastSequence INTEGER NOT NULL CHECK(lastSequence > 0),
  updatedAt TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS capacitylens_sync_row_provenance (
  tableName TEXT NOT NULL,
  rowId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  sessionId TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  rowHash TEXT NOT NULL CHECK(length(rowHash) = 64),
  PRIMARY KEY (tableName, rowId)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_capacitylens_sync_row_provenance_session
  ON capacitylens_sync_row_provenance(sessionId, sequence);

CREATE INDEX IF NOT EXISTS idx_capacitylens_sync_row_provenance_account
  ON capacitylens_sync_row_provenance(accountId);
`;

export interface SyncOrder {
  sessionId: string;
  sequence: number;
}

export interface SyncProvenanceResult {
  table: string;
  id: string;
  accountId: string;
  row?: Record<string, unknown>;
}

const SYNC_ORDER_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Per-Db cache for the two pure-read invariant SELECTs below (isSameSessionSuccessor,
 * isSupersededSyncBatch). Mirrors the WeakMap<Db,...> statement-cache idiom used elsewhere
 * (db.ts's statementCache, auth.ts's table-presence probes, txn.ts's activeTransactionModes): a
 * node:sqlite Statement is tied to the Db handle that prepared it, so the cache key is the handle
 * itself and an entry is collected with its handle — tests that open many short-lived in-memory
 * Dbs don't leak. recordAppliedSyncBatch is deliberately NOT cached here; it keeps preparing its
 * statements per call as before.
 */
type PreparedStatement = ReturnType<Db["prepare"]>;

interface SyncOrderingStatementCache {
  isSupersededSyncBatch?: PreparedStatement;
  isSameSessionSuccessor?: PreparedStatement;
}

const syncOrderingStatementCaches = new WeakMap<Db, SyncOrderingStatementCache>();

function syncOrderingStatementCache(db: Db): SyncOrderingStatementCache {
  let cache = syncOrderingStatementCaches.get(db);
  if (!cache) {
    cache = {};
    syncOrderingStatementCaches.set(db, cache);
  }
  return cache;
}

const columnShape = (db: Db, table: string) =>
  (
    db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }>
  ).map(({ name, type, notnull, pk }) => ({ name, type, notnull, pk }));

export function assertSyncOrderingCurrent(db: Db): void {
  const sessions = columnShape(db, "capacitylens_sync_sessions");
  const expectedSessions = [
    { name: "sessionId", type: "TEXT", notnull: 1, pk: 1 },
    { name: "lastSequence", type: "INTEGER", notnull: 1, pk: 0 },
    { name: "updatedAt", type: "TEXT", notnull: 1, pk: 0 },
  ];
  const provenance = columnShape(db, "capacitylens_sync_row_provenance");
  const expectedProvenance = [
    { name: "tableName", type: "TEXT", notnull: 1, pk: 1 },
    { name: "rowId", type: "TEXT", notnull: 1, pk: 2 },
    { name: "accountId", type: "TEXT", notnull: 1, pk: 0 },
    { name: "sessionId", type: "TEXT", notnull: 1, pk: 0 },
    { name: "sequence", type: "INTEGER", notnull: 1, pk: 0 },
    { name: "rowHash", type: "TEXT", notnull: 1, pk: 0 },
  ];
  const provenanceIndexes = db.prepare(`PRAGMA index_list(capacitylens_sync_row_provenance)`).all() as Array<{
    name: string;
  }>;
  const hasSessionIndex = provenanceIndexes.some(
    (index) => index.name === "idx_capacitylens_sync_row_provenance_session",
  );
  const hasAccountIndex = provenanceIndexes.some(
    (index) => index.name === "idx_capacitylens_sync_row_provenance_account",
  );
  if (
    JSON.stringify(sessions) !== JSON.stringify(expectedSessions) ||
    JSON.stringify(provenance) !== JSON.stringify(expectedProvenance) ||
    !hasSessionIndex ||
    !hasAccountIndex
  ) {
    throw new Error("Sync-ordering schema does not match the current successor-write contract.");
  }
}

export function isSupersededSyncBatch(db: Db, order: SyncOrder): boolean {
  const cache = syncOrderingStatementCache(db);
  const stmt = (cache.isSupersededSyncBatch ??= db.prepare(
    `SELECT lastSequence FROM capacitylens_sync_sessions WHERE sessionId = ?`,
  ));
  const row = stmt.get(order.sessionId) as { lastSequence: number } | undefined;
  return row !== undefined && row.lastSequence >= order.sequence;
}

const hashRow = (row: Record<string, unknown>): string =>
  createHash("sha256").update(JSON.stringify(row)).digest("hex");

/** True only when the current stored row is exactly the result of an earlier batch from this
 * browser sync session. This lets its already-dispatched successor advance past the predecessor's
 * server-owned revision without treating an intervening write from another actor as its own. */
export function isSameSessionSuccessor(
  db: Db,
  order: SyncOrder,
  table: string,
  id: string,
  current: Record<string, unknown>,
): boolean {
  const cache = syncOrderingStatementCache(db);
  const stmt = (cache.isSameSessionSuccessor ??= db.prepare(
    `
    SELECT sessionId, sequence, rowHash
      FROM capacitylens_sync_row_provenance
     WHERE tableName = ? AND rowId = ?
  `,
  ));
  const provenance = stmt.get(table, id) as { sessionId: string; sequence: number; rowHash: string } | undefined;
  return (
    provenance !== undefined &&
    provenance.sessionId === order.sessionId &&
    provenance.sequence < order.sequence &&
    provenance.rowHash === hashRow(current)
  );
}

/** Record ordering and exact resulting row provenance inside the same transaction as the batch. */
export function recordAppliedSyncBatch(db: Db, order: SyncOrder, results: readonly SyncProvenanceResult[]): void {
  const now = new Date();
  const retentionCutoff = new Date(now.getTime() - SYNC_ORDER_RETENTION_MS).toISOString();
  db.prepare(
    `
    DELETE FROM capacitylens_sync_row_provenance
     WHERE sessionId IN (
       SELECT sessionId FROM capacitylens_sync_sessions WHERE updatedAt < ?
     )
  `,
  ).run(retentionCutoff);
  db.prepare(`DELETE FROM capacitylens_sync_sessions WHERE updatedAt < ?`).run(retentionCutoff);

  db.prepare(
    `
    INSERT INTO capacitylens_sync_sessions (sessionId, lastSequence, updatedAt)
    VALUES (?, ?, ?)
    ON CONFLICT(sessionId) DO UPDATE SET
      lastSequence = excluded.lastSequence,
      updatedAt = excluded.updatedAt
    WHERE excluded.lastSequence > capacitylens_sync_sessions.lastSequence
  `,
  ).run(order.sessionId, order.sequence, now.toISOString());

  const remember = db.prepare(`
    INSERT INTO capacitylens_sync_row_provenance (
      tableName, rowId, accountId, sessionId, sequence, rowHash
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(tableName, rowId) DO UPDATE SET
      accountId = excluded.accountId,
      sessionId = excluded.sessionId,
      sequence = excluded.sequence,
      rowHash = excluded.rowHash
  `);
  const forget = db.prepare(`
    DELETE FROM capacitylens_sync_row_provenance WHERE tableName = ? AND rowId = ?
  `);
  for (const result of results) {
    if (result.row === undefined) {
      forget.run(result.table, result.id);
    } else {
      remember.run(result.table, result.id, result.accountId, order.sessionId, order.sequence, hashRow(result.row));
    }
  }
}

/** Provenance is tenant-scoped operational metadata and leaves with the workspace. */
export function forgetWorkspaceSyncProvenance(db: Db, accountId: string): void {
  db.prepare(`DELETE FROM capacitylens_sync_row_provenance WHERE accountId = ?`).run(accountId);
}
