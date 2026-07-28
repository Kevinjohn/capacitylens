import { randomUUID } from 'node:crypto'
import type { AuditEntry, AuditSink } from './audit'
import type { Db } from './db'

/** Immutable v17 schema component. Keep changes to this SQL behind a new explicit migration once
 * v17 ships: its exact text is folded into the migration ledger checksum. */
export const AUDIT_OUTBOX_SQL = `
CREATE TABLE IF NOT EXISTS capacitylens_audit_outbox (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL,
  createdAt TEXT NOT NULL
) STRICT;
`

export function assertAuditOutboxCurrent(db: Db): void {
  const columns = (db.prepare(`PRAGMA table_info(capacitylens_audit_outbox)`).all() as Array<{
    name: string
    type: string
    notnull: number
    pk: number
  }>).map(({ name, type, notnull, pk }) => ({ name, type, notnull, pk }))
  const expected = [
    { name: 'sequence', type: 'INTEGER', notnull: 0, pk: 1 },
    { name: 'id', type: 'TEXT', notnull: 1, pk: 0 },
    { name: 'payload', type: 'TEXT', notnull: 1, pk: 0 },
    { name: 'createdAt', type: 'TEXT', notnull: 1, pk: 0 },
  ]
  if (JSON.stringify(columns) !== JSON.stringify(expected)) {
    throw new Error('Audit outbox schema does not match the current durable-delivery contract.')
  }
}

interface AuditOutboxRow {
  sequence: number
  id: string
  payload: string
}

/** Enqueue inside the same SQLite transaction as the represented mutation. */
export function enqueueAudit(
  db: Db,
  record: AuditEntry,
  id: string = randomUUID(),
): string {
  db.prepare(
    `INSERT INTO capacitylens_audit_outbox (id, payload, createdAt) VALUES (?, ?, ?)`,
  ).run(id, JSON.stringify(record), new Date().toISOString())
  return id
}

/** Deliver pending rows in commit order. A failed sink leaves this row and every later row intact.
 * Deletion happens only after append reports that its fsync/idempotency boundary succeeded. */
export function drainAuditOutbox(db: Db, sink: AuditSink): boolean {
  const select = db.prepare(
    `SELECT sequence, id, payload FROM capacitylens_audit_outbox ORDER BY sequence LIMIT 1`,
  )
  const remove = db.prepare(`DELETE FROM capacitylens_audit_outbox WHERE sequence = ? AND id = ?`)
  for (;;) {
    const row = select.get() as AuditOutboxRow | undefined
    if (!row) return true
    const parsed: unknown = JSON.parse(row.payload)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`Audit outbox row ${row.id} does not contain an object payload.`)
    }
    const entry = { ...(parsed as AuditEntry), auditId: row.id }
    if (!sink.append(entry)) return false
    const result = remove.run(row.sequence, row.id)
    if (result.changes !== 1) {
      throw new Error(`Audit outbox row ${row.id} changed during delivery.`)
    }
  }
}

export function pendingAuditCount(db: Db): number {
  return Number(
    (db.prepare(`SELECT COUNT(*) AS count FROM capacitylens_audit_outbox`).get() as { count: number }).count,
  )
}
