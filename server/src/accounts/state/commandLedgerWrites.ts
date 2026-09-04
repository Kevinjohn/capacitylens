import type { AccountErrorCode } from "@capacitylens/shared/account/errors";
import type { CommandId, IdempotencyKey, PrincipalId, WorkspaceId } from "@capacitylens/shared/account/types";
import type { Db } from "../../db";
import {
  type AccountCommandRecord,
  type AccountCommandStatus,
  getAccountCommand,
  getAccountCommandById,
  getAccountCommandByGlobalId,
} from "./commandLedgerReads";
import { HOUSEKEEPING_INTERVAL_MS, lastCommandSweep, stableNowMs, stableNowIso } from "./runtime";

const COMMAND_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const PENDING_RECONCILIATION_MS = 15 * 60 * 1000;

function transitionStalePending(db: Db, record: AccountCommandRecord, nowMs: number): AccountCommandRecord {
  const updatedAtMs = Date.parse(record.updatedAt);
  // A corrupt/unparseable timestamp fails forward into reconciliation: leaving an unknowably old
  // pending command live forever would preserve neither idempotency nor an operator repair path.
  if (record.status !== "pending" || (Number.isFinite(updatedAtMs) && updatedAtMs > nowMs - PENDING_RECONCILIATION_MS))
    return record;
  finishAccountCommand(db, {
    applicationId: record.applicationId,
    operation: record.operation,
    idempotencyKey: record.idempotencyKey,
    status: "reconciliation_required",
    failureCode: "DEPENDENCY_UNAVAILABLE",
    resultJson: JSON.stringify({ kind: "stale-pending" }),
    now: new Date(nowMs).toISOString(),
  });
  return getAccountCommand(db, record.applicationId, record.operation, record.idempotencyKey)!;
}

/** A reconciliation read is also the timeout boundary for abandoned in-flight commands. */
export function getAccountCommandByIdForReconciliation(
  db: Db,
  applicationId: string,
  commandId: CommandId,
  now = stableNowMs(),
): AccountCommandRecord | null {
  const record = getAccountCommandById(db, applicationId, commandId);
  return record ? transitionStalePending(db, record, now) : null;
}

export type ReserveAccountCommandResult =
  | { kind: "reserved"; record: AccountCommandRecord }
  | { kind: "existing"; record: AccountCommandRecord }
  | { kind: "conflict"; record: AccountCommandRecord };

export function reserveAccountCommand(
  db: Db,
  input: {
    applicationId: string;
    operation: string;
    idempotencyKey: IdempotencyKey;
    commandId: CommandId;
    actorPrincipalId: PrincipalId | null;
    targetPrincipalId?: PrincipalId | null;
    workspaceId?: WorkspaceId | null;
    payloadHash: string;
    now?: string;
  },
): ReserveAccountCommandResult {
  if (!/^[a-f0-9]{64}$/.test(input.payloadHash)) {
    throw new Error("Account command payloadHash must be a lowercase SHA-256 digest.");
  }
  const nowMs = input.now === undefined ? stableNowMs() : Date.parse(input.now);
  const lastSweep = lastCommandSweep.get(db);
  if (lastSweep === undefined || nowMs - lastSweep >= HOUSEKEEPING_INTERVAL_MS) {
    db.prepare(
      `
      DELETE FROM account_commands
       WHERE status IN ('completed', 'compensated') AND updatedAt < ?
    `,
    ).run(new Date(nowMs - COMMAND_RETENTION_MS).toISOString());
    lastCommandSweep.set(db, nowMs);
  }
  const existing = getAccountCommand(db, input.applicationId, input.operation, input.idempotencyKey);
  if (existing) {
    // An idempotency key is authority-neutral, but its result is not. Never let a command retained
    // by a shared browser replay, age, or otherwise mutate another principal's ledger ceremony.
    if (existing.actorPrincipalId !== input.actorPrincipalId) {
      return { kind: "conflict", record: existing };
    }
    const reconciled = transitionStalePending(db, existing, nowMs);
    return reconciled.payloadHash === input.payloadHash && reconciled.commandId === input.commandId
      ? { kind: "existing", record: reconciled }
      : { kind: "conflict", record: reconciled };
  }
  // commandId is a durable reconciliation handle and is globally unique in the frozen v15 schema.
  // Normalize reuse across a different operation/key/application instead of leaking a SQLite UNIQUE
  // failure as an unexpected 500.
  const commandIdOwner = getAccountCommandByGlobalId(db, input.commandId);
  if (commandIdOwner) return { kind: "conflict", record: commandIdOwner };
  const now = input.now ?? new Date(nowMs).toISOString();
  db.prepare(
    `
    INSERT INTO account_commands (
      applicationId, operation, idempotencyKey, commandId, actorPrincipalId, targetPrincipalId,
      workspaceId, payloadHash,
      status, resultJson, failureCode, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?)
  `,
  ).run(
    input.applicationId,
    input.operation,
    input.idempotencyKey,
    input.commandId,
    input.actorPrincipalId,
    input.targetPrincipalId ?? null,
    input.workspaceId ?? null,
    input.payloadHash,
    now,
    now,
  );
  return {
    kind: "reserved",
    record: getAccountCommand(db, input.applicationId, input.operation, input.idempotencyKey)!,
  };
}

/** Add newly learned privacy/repair coordinates to a still-pending coordinator command. */
export function correlatePendingAccountCommand(
  db: Db,
  input: {
    applicationId: string;
    operation: string;
    idempotencyKey: IdempotencyKey;
    workspaceId?: WorkspaceId;
    targetPrincipalId?: PrincipalId;
    now?: string;
  },
): void {
  const row = getAccountCommand(db, input.applicationId, input.operation, input.idempotencyKey);
  if (!row || row.status !== "pending") {
    throw new Error("Only a pending account command may receive correlation coordinates.");
  }
  if (input.workspaceId !== undefined && row.workspaceId !== null && row.workspaceId !== input.workspaceId) {
    throw new Error("A pending account command cannot be rebound to another workspace.");
  }
  if (
    input.targetPrincipalId !== undefined &&
    row.targetPrincipalId !== null &&
    row.targetPrincipalId !== input.targetPrincipalId
  ) {
    throw new Error("A pending account command cannot be rebound to another principal.");
  }
  const result = db
    .prepare(
      `
    UPDATE account_commands
       SET workspaceId = COALESCE(workspaceId, ?),
           targetPrincipalId = COALESCE(targetPrincipalId, ?),
           updatedAt = ?
     WHERE applicationId = ? AND operation = ? AND idempotencyKey = ? AND status = 'pending'
  `,
    )
    .run(
      input.workspaceId ?? null,
      input.targetPrincipalId ?? null,
      input.now ?? stableNowIso(),
      input.applicationId,
      input.operation,
      input.idempotencyKey,
    );
  if (result.changes !== 1) {
    throw new Error("Pending account-command correlation was lost concurrently.");
  }
}

export function finishAccountCommandIfPending(db: Db, input: Parameters<typeof finishAccountCommand>[1]): boolean {
  const row = getAccountCommand(db, input.applicationId, input.operation, input.idempotencyKey);
  if (!row || row.status !== "pending") return false;
  finishAccountCommand(db, input);
  return true;
}

export function eraseWorkspaceCommandHistoryInTx(db: Db, workspaceId: WorkspaceId, exceptCommandId?: CommandId): void {
  // Closed successful/compensated rows are disposable history. Pending and repair-required rows
  // are live coordination state: deleting either can strand an external side effect and erase its
  // only recovery coordinates while the owning flow is still running or awaiting an operator.
  if (exceptCommandId === undefined) {
    db.prepare(
      `
      DELETE FROM account_commands
       WHERE workspaceId = ? AND status IN ('completed', 'compensated')
    `,
    ).run(workspaceId);
    return;
  }
  db.prepare(
    `
    DELETE FROM account_commands
     WHERE workspaceId = ?
       AND commandId <> ?
       AND status IN ('completed', 'compensated')
  `,
  ).run(workspaceId, exceptCommandId);
  db.prepare(
    `UPDATE account_commands
        SET workspaceId = NULL, actorPrincipalId = NULL, targetPrincipalId = NULL
      WHERE commandId = ? AND workspaceId = ?`,
  ).run(exceptCommandId, workspaceId);
}

/** Erase command-ledger correlation for a local principal that is itself being erased. */
export function erasePrincipalCommandHistoryInTx(db: Db, principalId: PrincipalId, exceptCommandId?: CommandId): void {
  if (exceptCommandId) {
    db.prepare(
      `
      DELETE FROM account_commands
       WHERE (actorPrincipalId = ? OR targetPrincipalId = ?) AND commandId <> ?
    `,
    ).run(principalId, principalId, exceptCommandId);
    db.prepare(
      `
      UPDATE account_commands
         SET actorPrincipalId = CASE WHEN actorPrincipalId = ? THEN NULL ELSE actorPrincipalId END,
             targetPrincipalId = CASE WHEN targetPrincipalId = ? THEN NULL ELSE targetPrincipalId END
       WHERE commandId = ?
    `,
    ).run(principalId, principalId, exceptCommandId);
    return;
  }
  db.prepare(`DELETE FROM account_commands WHERE actorPrincipalId = ? OR targetPrincipalId = ?`).run(
    principalId,
    principalId,
  );
}

/** Operator-only closure after the recorded repair target has been inspected and repaired. */
export function closeAccountCommandReconciliation(
  db: Db,
  applicationId: string,
  commandId: CommandId,
  referenceHash: string,
): boolean {
  if (!/^[a-f0-9]{64}$/.test(referenceHash)) {
    throw new Error("The reconciliation reference must be supplied as a lowercase SHA-256 digest.");
  }
  const result = db
    .prepare(
      `
    UPDATE account_commands
       SET status = 'compensated',
           resultJson = json_object('kind', 'operator-closed', 'referenceHash', ?),
           updatedAt = ?
     WHERE applicationId = ? AND commandId = ? AND status = 'reconciliation_required'
  `,
    )
    .run(referenceHash, stableNowIso(), applicationId, commandId);
  return result.changes === 1;
}

export function finishAccountCommand(
  db: Db,
  input: {
    applicationId: string;
    operation: string;
    idempotencyKey: IdempotencyKey;
    status: Exclude<AccountCommandStatus, "pending">;
    resultJson?: string | null;
    failureCode?: AccountErrorCode | null;
    now?: string;
  },
): void {
  const result = db
    .prepare(
      `
    UPDATE account_commands
       SET status = ?, resultJson = ?, failureCode = ?, updatedAt = ?
     WHERE applicationId = ? AND operation = ? AND idempotencyKey = ? AND status = 'pending'
  `,
    )
    .run(
      input.status,
      input.resultJson ?? null,
      input.failureCode ?? null,
      input.now ?? stableNowIso(),
      input.applicationId,
      input.operation,
      input.idempotencyKey,
    );
  if (result.changes !== 1) {
    throw new Error("Account command could not transition from pending to a terminal state.");
  }
}
