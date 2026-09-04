import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { AuditRecord } from "../../audit";
import { enqueueAudit } from "../../auditOutbox";
import { BatchStateProjection } from "../../batchProjection";
import { getRow, upsertRow } from "../../db";
import { isSupersededSyncBatch, recordAppliedSyncBatch } from "../../syncOrdering";
import { tx } from "../../txn";
import { acceptedFieldNames } from "../../validate";
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

export async function runBatch(parameters: RunBatchParameters) {
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
  let supersededSyncBatch = false;
  // Assigned inside the lock/tx closure below, but read at response shaping outside it — declared
  // here (like revisions/lifecycleArchives above) so it stays in scope at both points. `changed`
  // is derived from this at response time rather than hand-counted, so a null-out site can never
  // drift from what's actually reported.
  let auditRecords: Array<AuditRecord | null> = [];
  await accountFlows.withWorkspaceErasureLocks(
    [],
    () => {
      // Lock acquisition may yield behind another membership/ownership mutation. Re-evaluate
      // every permission after the wait and immediately before the synchronous transaction so
      // the pre-scan can never become stale authorization for a destructive or cross-tenant op.
      if (!authorizeOperations()) throw new BatchAuthorizationResponseSent();
      // Lock acquisition may also have waited behind workspace provisioning. Classify against
      // the now-current database and project each preceding op so the audit verb describes the
      // same state the immediately following synchronous transaction will observe.
      const projectedRows = new Map<string, boolean>();
      const auditActions = ops.map((op): "create" | "update" | "delete" | "archive" | null => {
        const key = `${op.table}\0${op.id}`;
        const existed = projectedRows.has(key) ? projectedRows.get(key)! : Boolean(getRow(db, op.table, op.id));
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
      auditRecords = ops.map((op, opIndex): AuditRecord | null => {
        const action = auditActions[opIndex];
        if (action === null) return null;
        return op.method === "PUT"
          ? {
              ts: auditTs,
              userId: req.user!.id,
              accountId: (op.row as { accountId?: string } | undefined)?.accountId ?? op.id,
              action,
              entity: op.table,
              id: op.id,
              changedFields: acceptedFieldNames(op.table, op.row),
            }
          : op.method === "ARCHIVE"
            ? {
                ts: auditTs,
                userId: req.user!.id,
                accountId: op.accountId!,
                action: "archive",
                entity: op.table,
                id: op.id,
                changedFields: ["archivedAt"],
              }
            : {
                ts: auditTs,
                userId: req.user!.id,
                accountId: op.accountId ?? op.id,
                action: "delete",
                entity: op.table,
                id: op.id,
                changedFields: [],
              };
      });
      return tx(
        db,
        () => {
          if (syncOrder && isSupersededSyncBatch(db, syncOrder)) {
            supersededSyncBatch = true;
            return;
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
          for (const revision of projection.rewrittenAllocationRevisions()) {
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
              ops.map((op) => ({
                table: op.table,
                id: op.id,
                accountId:
                  op.table === "accounts" ? op.id : op.method === "PUT" ? (op.row!.accountId as string) : op.accountId!,
                row: getRow(db, op.table, op.id),
              })),
            );
          }
        },
        "immediate",
      );
    },
    {
      // Serialize every top-level account mutation with /api/orgs. The batch re-evaluates its
      // projected final count inside this lock and transaction, so concurrent first-company
      // batches cannot both commit against the same empty snapshot.
      serializeWorkspaceProvisioning: hasAccountOperations,
    },
  );
  return { supersededSyncBatch, auditRecords };
}
