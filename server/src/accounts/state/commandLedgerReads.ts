import type { AccountErrorCode } from "@capacitylens/shared/account/errors";
import type { CommandId, IdempotencyKey, PrincipalId, WorkspaceId } from "@capacitylens/shared/account/types";
import type { Db } from "../../db";

export type AccountCommandStatus = "pending" | "completed" | "compensated" | "reconciliation_required";

export interface AccountCommandRecord {
  applicationId: string;
  operation: string;
  idempotencyKey: IdempotencyKey;
  commandId: CommandId;
  actorPrincipalId: PrincipalId | null;
  targetPrincipalId: PrincipalId | null;
  workspaceId: WorkspaceId | null;
  payloadHash: string;
  status: AccountCommandStatus;
  resultJson: string | null;
  failureCode: AccountErrorCode | null;
  createdAt: string;
  updatedAt: string;
}

// Shared 13-column projection for account_commands, hoisted out of the three readers below (they
// differed only in WHERE). Interpolated verbatim, so the resulting SQL text is byte-identical to
// each reader's former standalone literal.
const ACCOUNT_COMMAND_COLUMNS = `applicationId, operation, idempotencyKey, commandId, actorPrincipalId, targetPrincipalId,
           workspaceId, payloadHash,
           status, resultJson, failureCode, createdAt, updatedAt`;

function commandRow(row: Record<string, unknown>): AccountCommandRecord {
  return {
    applicationId: String(row.applicationId),
    operation: String(row.operation),
    idempotencyKey: String(row.idempotencyKey),
    commandId: String(row.commandId),
    actorPrincipalId: typeof row.actorPrincipalId === "string" ? row.actorPrincipalId : null,
    targetPrincipalId: typeof row.targetPrincipalId === "string" ? row.targetPrincipalId : null,
    workspaceId: typeof row.workspaceId === "string" ? row.workspaceId : null,
    payloadHash: String(row.payloadHash),
    status: row.status as AccountCommandStatus,
    resultJson: typeof row.resultJson === "string" ? row.resultJson : null,
    failureCode: typeof row.failureCode === "string" ? (row.failureCode as AccountErrorCode) : null,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

export function getAccountCommand(
  db: Db,
  applicationId: string,
  operation: string,
  idempotencyKey: IdempotencyKey,
): AccountCommandRecord | null {
  const row = db
    .prepare(
      `
    SELECT ${ACCOUNT_COMMAND_COLUMNS}
      FROM account_commands
     WHERE applicationId = ? AND operation = ? AND idempotencyKey = ?
  `,
    )
    .get(applicationId, operation, idempotencyKey) as Record<string, unknown> | undefined;
  return row ? commandRow(row) : null;
}

export function getAccountCommandById(
  db: Db,
  applicationId: string,
  commandId: CommandId,
): AccountCommandRecord | null {
  const row = db
    .prepare(
      `
    SELECT ${ACCOUNT_COMMAND_COLUMNS}
      FROM account_commands
     WHERE applicationId = ? AND commandId = ?
  `,
    )
    .get(applicationId, commandId) as Record<string, unknown> | undefined;
  return row ? commandRow(row) : null;
}

export function getAccountCommandByGlobalId(db: Db, commandId: CommandId): AccountCommandRecord | null {
  const row = db
    .prepare(
      `
    SELECT ${ACCOUNT_COMMAND_COLUMNS}
      FROM account_commands
     WHERE commandId = ?
  `,
    )
    .get(commandId) as Record<string, unknown> | undefined;
  return row ? commandRow(row) : null;
}
