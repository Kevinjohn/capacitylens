import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { AuditRecord } from "../../audit";
import { enqueueAudit } from "../../auditOutbox";
import { BatchStateProjection } from "../../BatchStateProjection";
import { getRow, upsertRow } from "../../db";
import { isSupersededSyncBatch, recordAppliedSyncBatch } from "../../syncOrdering";
import { tx } from "../../txn";
import { listAcceptedFieldNames } from "../../validate";
import { FULL_SLICE_READ } from "../../writePipeline";

import { appendAppDataSlice } from "./appData";
import { applyBatchOperation } from "./applyOperation";
import { projectBatchAccounts } from "./authorize";
import { BatchAuthorizationResponseSent } from "./errors";
import { type ApplyBatchOperationParameters, type BatchOp } from "./types";

type RunBatchParameters = Pick<
  ApplyBatchOperationParameters,
  | "req"
  | "db"
  | "store"
  | "optimisticConcurrency"
  | "multiAccount"
  | "accountFlows"
  | "fieldVisFor"
  | "redactWriteEcho"
  | "revisions"
  | "lifecycleArchives"
  | "syncOrder"
> & {
  ops: BatchOp[];
  affectedAccountIds: Set<string>;
  hasAccountOperations: boolean;
  authorizeOperations: () => boolean;
};

type BatchRunResult = { kind: "superseded" } | { kind: "applied"; auditRecords: Array<AuditRecord | null> };

function buildAuditRecords({
  ops,
  db,
  req,
}: Pick<RunBatchParameters, "ops" | "db" | "req">): Array<AuditRecord | null> {
  const projectedRows = new Map<string, boolean>();
  const auditActions = ops.map((op): "create" | "update" | "delete" | "archive" | null => {
    const key = `${op.table}\0${op.id}`;
    const existed = projectedRows.get(key) ?? Boolean(getRow(db, op.table, op.id));
    if (op.method === "PUT") {
      projectedRows.set(key, true);
      return existed ? "update" : "create";
    }
    if (op.method === "ARCHIVE") {
      projectedRows.set(key, existed);
      return existed ? "archive" : null;
    }
    projectedRows.set(key, false);
    return existed ? "delete" : null;
  });
  const auditTs = new Date().toISOString();
  return ops.map((op, opIndex): AuditRecord | null => {
    const action = auditActions[opIndex];
    if (action == null) return null;
    const userId = req.user?.id;
    if (userId === undefined) throw new Error("An audited batch operation requires an authenticated user.");
    if (op.method === "PUT") {
      return {
        ts: auditTs,
        userId,
        accountId: (op.row as { accountId?: string } | undefined)?.accountId ?? op.id,
        action,
        entity: op.table,
        id: op.id,
        changedFields: listAcceptedFieldNames(op.table, op.row),
      };
    }
    if (op.method === "ARCHIVE") {
      if (typeof op.accountId !== "string") throw new Error("An audited archive requires an account ID.");
      return {
        ts: auditTs,
        userId,
        accountId: op.accountId,
        action: "archive",
        entity: op.table,
        id: op.id,
        changedFields: ["archivedAt"],
      };
    }
    return {
      ts: auditTs,
      userId,
      accountId: op.accountId ?? op.id,
      action: "delete",
      entity: op.table,
      id: op.id,
      changedFields: [],
    };
  });
}

function resolveSyncAccountId(op: BatchOp): string {
  if (op.table === "accounts") return op.id;
  if (op.method === "PUT") {
    const accountId = op.row?.accountId;
    if (typeof accountId !== "string") throw new Error("A synced scoped write requires an account ID.");
    return accountId;
  }
  if (typeof op.accountId !== "string") throw new Error("A synced scoped mutation requires an account ID.");
  return op.accountId;
}

export async function runBatch(parameters: RunBatchParameters): Promise<BatchRunResult> {
  const {
    ops,
    syncOrder,
    req,
    db,
    store,
    optimisticConcurrency,
    multiAccount,
    accountFlows,
    fieldVisFor,
    redactWriteEcho,
    revisions,
    lifecycleArchives,
    affectedAccountIds,
    hasAccountOperations,
    authorizeOperations,
  } = parameters;
  // Assigned inside the lock before the transaction and returned with its outcome. `changed` is
  // derived from these records at response time rather than hand-counted, so a null-out site can
  // never drift from what's actually reported.
  let auditRecords: Array<AuditRecord | null> = [];
  return accountFlows.withWorkspaceErasureLocks(
    [],
    () => {
      // Lock acquisition may yield behind another membership/ownership mutation. Re-evaluate
      // every permission after the wait and immediately before the synchronous transaction so
      // the pre-scan can never become stale authorization for a destructive or cross-tenant op.
      if (!authorizeOperations()) throw new BatchAuthorizationResponseSent();
      // Lock acquisition may also have waited behind workspace provisioning. Classify against
      // the now-current database and project each preceding op so the audit verb describes the
      // same state the immediately following synchronous transaction will observe.
      auditRecords = buildAuditRecords({ ops, db, req });
      const applied = tx(
        db,
        () => {
          if (syncOrder && isSupersededSyncBatch(db, syncOrder)) {
            return false;
          }
          // Read every relationship table, but only for accounts this request targets. `state` is
          // then advanced in lockstep with each write (upsert/cascade helpers) so op N validates
          // against exactly the state ops 1..N-1 produced without scanning unrelated tenants.
          const state = emptyAppData();
          for (const accountId of affectedAccountIds) {
            appendAppDataSlice(state, store.readSlice(accountId, FULL_SLICE_READ));
          }
          const projection = new BatchStateProjection(state);
          // Recompute under the provisioning lock: the earlier cap projection may have waited
          // behind another top-level account mutation. A scalar COUNT is sufficient; validation's
          // account rows are already present in the affected slices above.
          const projectedWorkspaceCount = hasAccountOperations ? projectBatchAccounts(db, ops).count : 0;
          const mintedInternalIds = new Set<string>();
          for (const [opIndex, op] of ops.entries()) {
            applyBatchOperation({
              opIndex,
              op,
              req,
              db,
              store,
              state,
              projection,
              mintedInternalIds,
              revisions,
              auditRecords,
              lifecycleArchives,
              syncOrder,
              optimisticConcurrency,
              multiAccount,
              projectedWorkspaceCount,
              accountFlows,
              fieldVisFor,
              redactWriteEcho,
            });
          }
          for (const revision of projection.listRewrittenAllocationRevisions()) {
            const allocation = projection.row("allocations", revision.id);
            if (!allocation) throw new Error("Projected allocation rewrite is missing its final row.");
            upsertRow(db, "allocations", allocation);
            revisions.push({ table: "allocations", ...revision, rewrite: true });
          }
          for (const record of auditRecords) {
            if (record) enqueueAudit(db, record);
          }
          if (syncOrder) {
            recordAppliedSyncBatch(
              db,
              syncOrder,
              ops.map((op) => {
                const row = getRow(db, op.table, op.id);
                return {
                  table: op.table,
                  id: op.id,
                  accountId: resolveSyncAccountId(op),
                  ...(row === null ? {} : { row }),
                };
              }),
            );
          }
          return true;
        },
        "immediate",
      );
      return applied ? { kind: "applied", auditRecords } : { kind: "superseded" };
    },
    {
      // Serialize every top-level account mutation with /api/orgs. The batch re-evaluates its
      // projected final count inside this lock and transaction, so concurrent first-company
      // batches cannot both commit against the same empty snapshot.
      serializeWorkspaceProvisioning: hasAccountOperations,
    },
  );
}
