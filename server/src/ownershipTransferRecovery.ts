import { existsSync } from "node:fs";
import type { AccountAuditEvent } from "@capacitylens/shared/account/audit";
import { DEFAULT_ACCOUNT_APPLICATION } from "./auth";
import { assertAuditOutboxCurrent, enqueueAudit } from "./auditOutbox";
import { assertOwnershipTransfersCurrent } from "./controlTables/ownershipTransfersSchema";
import { openDbConnection, planDatabaseMigrations, type Db } from "./db";
import { acquireExclusiveDatabaseLock } from "./resetOwnerPassword";
import { tx } from "./txn";

type RevisionStatus = "advanceable" | "exhausted" | "corrupt";
type LiveState = "awaiting_target" | "awaiting_owner";

interface RecoveryRequestRow {
  id: string;
  accountId: string;
  initiatorUserId: string;
  targetUserId: string;
  state: string;
  revision: string;
}

export interface InspectOwnershipTransferRecoveryInput {
  databasePath: string;
  accountId: string;
  requestId: string;
}

export interface OwnershipTransferRecoveryInspection {
  status: Exclude<RevisionStatus, "advanceable">;
  accountId: string;
  requestId: string;
  state: LiveState;
  revision: string;
  initiatorUserId: string;
  targetUserId: string;
}

export interface CancelOwnershipTransferRecoveryInput extends InspectOwnershipTransferRecoveryInput {
  expectedRevision: string;
  confirmServerStopped: boolean;
  now?: () => Date;
  auditId?: () => string;
}

export interface OwnershipTransferRecoveryResult {
  status: "cancelled";
  accountId: string;
  requestId: string;
  previousState: LiveState;
  revision: string;
  terminalAt: string;
  auditId: string;
}

const LIVE_STATES = new Set<string>(["awaiting_target", "awaiting_owner"]);
const MAX_ADVANCEABLE_REVISION = BigInt(Number.MAX_SAFE_INTEGER - 1);
const MAX_SAFE_REVISION = BigInt(Number.MAX_SAFE_INTEGER);

function classifyRevision(revision: string): RevisionStatus {
  if (!/^\d+$/.test(revision)) return "corrupt";
  const value = BigInt(revision);
  if (value <= MAX_ADVANCEABLE_REVISION) return "advanceable";
  if (value === MAX_SAFE_REVISION) return "exhausted";
  return "corrupt";
}

function validateTarget(input: InspectOwnershipTransferRecoveryInput): void {
  if (input.databasePath === ":memory:" || !existsSync(input.databasePath)) {
    throw new Error("The recovery database must be an existing on-disk CapacityLens database.");
  }
  if (!input.accountId || !input.requestId) {
    throw new Error("The company id and request id must both be non-empty exact identifiers.");
  }
}

function assertRecoverySchemasCurrent(db: Db): void {
  const migrationPlan = planDatabaseMigrations(db);
  if (migrationPlan.migrations.length > 0) {
    throw new Error(
      `Database schema v${migrationPlan.fromVersion} is not current (expected v${migrationPlan.toVersion}); ` +
        "start this release normally to complete its backed-up migration before recovery.",
    );
  }
  assertOwnershipTransfersCurrent(db);
  assertAuditOutboxCurrent(db);
}

function assertDatabaseIntegrity(db: Db): void {
  const quickCheck = db.prepare("PRAGMA quick_check").all() as Array<{ quick_check: string }>;
  if (quickCheck.length !== 1 || quickCheck[0]?.quick_check !== "ok") {
    throw new Error("SQLite quick_check failed; restore or investigate the database before recovery.");
  }
  if (db.prepare("PRAGMA foreign_key_check").all().length > 0) {
    throw new Error("SQLite foreign_key_check failed; restore or investigate the database before recovery.");
  }
}

function readExactRequest(db: Db, accountId: string, requestId: string): RecoveryRequestRow {
  const row = db
    .prepare(
      `SELECT id, accountId, initiatorUserId, targetUserId, state, revision
         FROM account_ownership_transfers
        WHERE id = ? AND accountId = ?`,
    )
    .get(requestId, accountId) as RecoveryRequestRow | undefined;
  if (!row) throw new Error("The ownership-transfer request does not exactly match that company id and request id.");
  return row;
}

function requireRecoverable(row: RecoveryRequestRow): OwnershipTransferRecoveryInspection {
  if (!LIVE_STATES.has(row.state)) {
    throw new Error("The exactly matched ownership-transfer request is not live; no recovery was performed.");
  }
  const status = classifyRevision(row.revision);
  if (status === "advanceable") {
    throw new Error("The exactly matched live request has an advanceable revision; investigate the reported failure.");
  }
  return {
    status,
    accountId: row.accountId,
    requestId: row.id,
    state: row.state as LiveState,
    revision: row.revision,
    initiatorUserId: row.initiatorUserId,
    targetUserId: row.targetUserId,
  };
}

function inspectOnHandle(db: Db, input: InspectOwnershipTransferRecoveryInput): OwnershipTransferRecoveryInspection {
  assertRecoverySchemasCurrent(db);
  assertDatabaseIntegrity(db);
  return requireRecoverable(readExactRequest(db, input.accountId, input.requestId));
}

/** Read-only rehearsal step. It identifies one exact live request and refuses normal revisions. */
export function inspectBrokenOwnershipTransfer(
  input: InspectOwnershipTransferRecoveryInput,
): OwnershipTransferRecoveryInspection {
  validateTarget(input);
  const db = openDbConnection(input.databasePath);
  try {
    return inspectOnHandle(db, input);
  } finally {
    db.close();
  }
}

/**
 * Cancel one corrupt or exhausted live request while the server is stopped. The bad revision stays
 * unchanged on the terminal row: it is evidence and cannot be advanced or reused. The row change
 * and account audit outbox event commit together.
 */
export function cancelBrokenOwnershipTransfer(
  input: CancelOwnershipTransferRecoveryInput,
): OwnershipTransferRecoveryResult {
  validateTarget(input);
  if (!input.confirmServerStopped) {
    throw new Error(
      "Refusing without --confirm-server-stopped. Stop the CapacityLens server first; the exclusive database lock enforces this.",
    );
  }
  const db = openDbConnection(input.databasePath);
  try {
    acquireExclusiveDatabaseLock(db);
    const inspection = inspectOnHandle(db, input);
    if (inspection.revision !== input.expectedRevision) {
      throw new Error(
        "The live request revision does not exactly match the expected revision; no recovery was performed.",
      );
    }
    return tx(db, () => {
      const terminalAt = (input.now ?? (() => new Date()))().toISOString();
      const result = db
        .prepare(
          `UPDATE account_ownership_transfers
              SET state = 'cancelled', terminalAt = ?, terminalReason = 'owner_cancelled'
            WHERE id = ? AND accountId = ? AND state = ? AND revision = ?`,
        )
        .run(terminalAt, input.requestId, input.accountId, inspection.state, input.expectedRevision);
      if (result.changes !== 1) {
        throw new Error("The ownership-transfer request changed before commit; no recovery was performed.");
      }
      // One request can be recovered only once. Binding the event id to that immutable request and
      // terminal instant makes retries diagnosable without introducing a secret or random key.
      const auditId = (input.auditId ?? (() => `ownership-transfer-recovery:${input.requestId}:${terminalAt}`))();
      const event: AccountAuditEvent = {
        id: auditId,
        occurredAt: terminalAt,
        applicationId: DEFAULT_ACCOUNT_APPLICATION.applicationId,
        workspaceId: input.accountId,
        actorPrincipalId: null,
        targetPrincipalId: null,
        commandId: null,
        action: "ownership_transfer.cancelled",
        outcome: "success",
        changedFields: ["state", "terminalAt", "terminalReason"],
      };
      enqueueAudit(db, event, auditId);
      assertDatabaseIntegrity(db);
      return {
        status: "cancelled",
        accountId: input.accountId,
        requestId: input.requestId,
        previousState: inspection.state,
        revision: inspection.revision,
        terminalAt,
        auditId,
      };
    });
  } finally {
    db.close();
  }
}
