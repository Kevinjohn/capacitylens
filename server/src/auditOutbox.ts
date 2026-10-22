import { assertTableColumns } from "./schema/introspection";
import { randomUUID } from "node:crypto";
import type { AuditEntry, AuditSink } from "./audit";
import { isAuditEntry } from "./auditEntryValidation";
export { isAuditEntry } from "./auditEntryValidation";
import type { Db } from "./db";
import { tx } from "./txn";

/** Immutable v17 schema component whose exact SQL participates in the released migration checksum. */
export const AUDIT_OUTBOX_SQL = `
CREATE TABLE IF NOT EXISTS capacitylens_audit_outbox (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL,
  createdAt TEXT NOT NULL
) STRICT;
`;

/** Rejects an outbox table whose columns do not match the durable-delivery contract. */
export function assertAuditOutboxCurrent(db: Db): void {
  assertTableColumns({
    db,
    table: "capacitylens_audit_outbox",
    expected: [
      { name: "sequence", type: "INTEGER", notnull: 0, pk: 1 },
      { name: "id", type: "TEXT", notnull: 1, pk: 0 },
      { name: "payload", type: "TEXT", notnull: 1, pk: 0 },
      { name: "createdAt", type: "TEXT", notnull: 1, pk: 0 },
    ],
    message: "Audit outbox schema does not match the current durable-delivery contract.",
  });
}

interface AuditOutboxRow {
  sequence: number;
  id: string;
  payload: string;
}

/** Bound every synchronous delivery turn; later pages are scheduled by the application drainer. */
export const AUDIT_DRAIN_PAGE_SIZE = 500;

type PreparedStatement = ReturnType<Db["prepare"]>;

// Cache statements per database handle because audit insertion runs inside nearly every write transaction.
// WeakMap ownership lets short-lived handles and their prepared statements be collected.
function createCachedStatement(sql: string): (db: Db) => PreparedStatement {
  const cache = new WeakMap<Db, PreparedStatement>();
  return (db: Db): PreparedStatement => {
    let statement = cache.get(db);
    if (!statement) {
      statement = db.prepare(sql);
      cache.set(db, statement);
    }
    return statement;
  };
}

const insertAuditOutboxStatement = createCachedStatement(
  `INSERT INTO capacitylens_audit_outbox (id, payload, createdAt) VALUES (?, ?, ?)`,
);
const selectAuditOutboxPageStatement = createCachedStatement(
  `SELECT sequence, id, payload FROM capacitylens_audit_outbox ORDER BY sequence LIMIT ${AUDIT_DRAIN_PAGE_SIZE}`,
);
const removeAuditOutboxRowStatement = createCachedStatement(
  `DELETE FROM capacitylens_audit_outbox WHERE sequence = ? AND id = ?`,
);
const pendingAuditCountStatement = createCachedStatement(`SELECT COUNT(*) AS count FROM capacitylens_audit_outbox`);

/** Enqueue inside the same SQLite transaction as the represented mutation. */
export function enqueueAudit(db: Db, record: AuditEntry, id: string = randomUUID()): string {
  insertAuditOutboxStatement(db).run(id, JSON.stringify(record), new Date().toISOString());
  return id;
}

/** Deliver pending rows in commit order. A failed sink leaves this row and every later row intact.
 * Deletion happens only after append reports that its fsync/idempotency boundary succeeded. */
export function drainAuditOutbox(db: Db, sink: AuditSink): boolean {
  const select = selectAuditOutboxPageStatement(db);
  const remove = removeAuditOutboxRowStatement(db);
  const rows = select.all() as unknown as AuditOutboxRow[];
  if (rows.length === 0) return true;
  const validRows: AuditOutboxRow[] = [];
  const entries: AuditEntry[] = [];
  for (const row of rows) {
    const parsed: unknown = JSON.parse(row.payload);
    if (!isAuditEntry(parsed)) {
      // Deliver the valid committed prefix before a malformed head blocks later audit records.
      if (validRows.length > 0) break;
      throw new Error(`Audit outbox row ${row.id} does not contain a valid audit payload.`);
    }
    validRows.push(row);
    entries.push({ ...parsed, auditId: row.id });
  }
  if (sink.appendMany) {
    if (!sink.appendMany(entries)) return false;
    tx(db, () => {
      for (const row of validRows) {
        const result = remove.run(row.sequence, row.id);
        if (result.changes !== 1) throw new Error(`Audit outbox row ${row.id} changed during delivery.`);
      }
    });
    return true;
  }
  for (const [index, entry] of entries.entries()) {
    if (!sink.append(entry)) return false;
    const row = validRows[index];
    if (!row) throw new Error(`Missing audit outbox row for delivered entry ${index}.`);
    const result = remove.run(row.sequence, row.id);
    if (result.changes !== 1) throw new Error(`Audit outbox row ${row.id} changed during delivery.`);
  }
  return true;
}

/** Returns the number of audit records awaiting sink delivery. */
export function readPendingAuditCount(db: Db): number {
  return Number((pendingAuditCountStatement(db).get() as { count: number }).count);
}
