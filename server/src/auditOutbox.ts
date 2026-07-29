import { randomUUID } from "node:crypto";
import type { AccountAuditAction, AccountAuditEvent } from "@capacitylens/shared/account/audit";
import type { AuditEntry, AuditRecord, AuditSink } from "./audit";
import type { Db } from "./db";
import { isIsoInstant } from "@capacitylens/shared/account/types";

/** Immutable v17 schema component. Keep changes to this SQL behind a new explicit migration once
 * v17 ships: its exact text is folded into the migration ledger checksum. */
export const AUDIT_OUTBOX_SQL = `
CREATE TABLE IF NOT EXISTS capacitylens_audit_outbox (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL,
  createdAt TEXT NOT NULL
) STRICT;
`;

export function assertAuditOutboxCurrent(db: Db): void {
  const columns = (
    db.prepare(`PRAGMA table_info(capacitylens_audit_outbox)`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }>
  ).map(({ name, type, notnull, pk }) => ({ name, type, notnull, pk }));
  const expected = [
    { name: "sequence", type: "INTEGER", notnull: 0, pk: 1 },
    { name: "id", type: "TEXT", notnull: 1, pk: 0 },
    { name: "payload", type: "TEXT", notnull: 1, pk: 0 },
    { name: "createdAt", type: "TEXT", notnull: 1, pk: 0 },
  ];
  if (JSON.stringify(columns) !== JSON.stringify(expected)) {
    throw new Error("Audit outbox schema does not match the current durable-delivery contract.");
  }
}

interface AuditOutboxRow {
  sequence: number;
  id: string;
  payload: string;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

const PRODUCT_ACTION_VALUES = [
  "create",
  "update",
  "patch",
  "delete",
  "batch",
  "import",
  "archive",
  "unarchive",
  "softDelete",
  "purge",
  "memberRole",
  "memberRemove",
  "ownershipTransfer",
  "inviteCreate",
  "inviteAccept",
  "inviteRevoke",
  "passwordResetIssue",
  "sessionsRevoke",
] as const satisfies readonly AuditRecord["action"][];
const ACCOUNT_ACTION_VALUES = [
  "workspace.provisioned",
  "workspace.erased",
  "invitation.created",
  "invitation.accepted",
  "invitation.revoked",
  "member.role_changed",
  "member.removed",
  "ownership.transferred",
  "identity.password_reset_issued",
  "identity.sessions_revoked",
  "identity.local_deprovisioned",
  "flow.compensated",
  "flow.reconciliation_required",
] as const satisfies readonly AccountAuditAction[];
const ACCOUNT_OUTCOME_VALUES = [
  "success",
  "denied",
  "failed",
  "compensated",
] as const satisfies readonly AccountAuditEvent["outcome"][];

// Keep the runtime validators exhaustive when either owning union grows.
const productActionsAreExhaustive: Exclude<AuditRecord["action"], (typeof PRODUCT_ACTION_VALUES)[number]> extends never
  ? true
  : never = true;
const accountActionsAreExhaustive: Exclude<AccountAuditAction, (typeof ACCOUNT_ACTION_VALUES)[number]> extends never
  ? true
  : never = true;
const accountOutcomesAreExhaustive: Exclude<
  AccountAuditEvent["outcome"],
  (typeof ACCOUNT_OUTCOME_VALUES)[number]
> extends never
  ? true
  : never = true;
void productActionsAreExhaustive;
void accountActionsAreExhaustive;
void accountOutcomesAreExhaustive;

const PRODUCT_ACTIONS = new Set<string>(PRODUCT_ACTION_VALUES);
const ACCOUNT_ACTIONS = new Set<string>(ACCOUNT_ACTION_VALUES);
const ACCOUNT_OUTCOMES = new Set<string>(ACCOUNT_OUTCOME_VALUES);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNullableNonEmptyString(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

function isAuditEntry(value: unknown): value is AuditEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (!isStringArray(row.changedFields)) return false;
  if ("ts" in row) {
    return (
      isIsoInstant(row.ts) &&
      isNonEmptyString(row.userId) &&
      isNonEmptyString(row.accountId) &&
      isNonEmptyString(row.entity) &&
      isNonEmptyString(row.id) &&
      isNonEmptyString(row.action) &&
      PRODUCT_ACTIONS.has(row.action)
    );
  }
  return (
    isNonEmptyString(row.id) &&
    isIsoInstant(row.occurredAt) &&
    isNonEmptyString(row.applicationId) &&
    isNullableNonEmptyString(row.workspaceId) &&
    isNullableNonEmptyString(row.actorPrincipalId) &&
    isNullableNonEmptyString(row.targetPrincipalId) &&
    isNullableNonEmptyString(row.commandId) &&
    isNonEmptyString(row.action) &&
    ACCOUNT_ACTIONS.has(row.action) &&
    isNonEmptyString(row.outcome) &&
    ACCOUNT_OUTCOMES.has(row.outcome)
  );
}

/** Enqueue inside the same SQLite transaction as the represented mutation. */
export function enqueueAudit(db: Db, record: AuditEntry, id: string = randomUUID()): string {
  db.prepare(`INSERT INTO capacitylens_audit_outbox (id, payload, createdAt) VALUES (?, ?, ?)`).run(
    id,
    JSON.stringify(record),
    new Date().toISOString(),
  );
  return id;
}

/** Deliver pending rows in commit order. A failed sink leaves this row and every later row intact.
 * Deletion happens only after append reports that its fsync/idempotency boundary succeeded. */
export function drainAuditOutbox(db: Db, sink: AuditSink): boolean {
  const select = db.prepare(`SELECT sequence, id, payload FROM capacitylens_audit_outbox ORDER BY sequence LIMIT 1`);
  const remove = db.prepare(`DELETE FROM capacitylens_audit_outbox WHERE sequence = ? AND id = ?`);
  for (;;) {
    const row = select.get() as AuditOutboxRow | undefined;
    if (!row) return true;
    const parsed: unknown = JSON.parse(row.payload);
    if (!isAuditEntry(parsed)) {
      throw new Error(`Audit outbox row ${row.id} does not contain a valid audit payload.`);
    }
    const entry = { ...parsed, auditId: row.id };
    if (!sink.append(entry)) return false;
    const result = remove.run(row.sequence, row.id);
    if (result.changes !== 1) {
      throw new Error(`Audit outbox row ${row.id} changed during delivery.`);
    }
  }
}

export function pendingAuditCount(db: Db): number {
  return Number(
    (db.prepare(`SELECT COUNT(*) AS count FROM capacitylens_audit_outbox`).get() as { count: number }).count,
  );
}
