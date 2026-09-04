import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { Action } from "@capacitylens/shared/domain/access";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { LocalAccountFlows } from "../accounts/localAccountFlows";
import type { AuthMode } from "../auth";
import { type Db } from "../db";
import { tableHasGatedFields, type SanitizeWriteOptions } from "../fieldPolicy";
import { TABLES } from "../tables";
import type { TenantStore } from "../tenantStore";
import { SINGLE_COMPANY_CAP_MESSAGE } from "./accountEntityRoutes";
import { isScopedTable } from "./routeShared";

import { authorizeBatchOperations, projectBatchAccounts } from "./batch/authorize";
import { BatchAuthorizationResponseSent, StaleWriteError } from "./batch/errors";
import { runBatch } from "./batch/runBatch";
import { type BatchRevision } from "./batch/types";
import { validateBatchRequest } from "./batch/validateRequest";
export { MAX_BATCH_OPS } from "./batch/types";

export interface BatchRouteDependencies {
  db: Db;
  store: TenantStore;
  authMode: AuthMode;
  multiAccount: boolean;
  optimisticConcurrency: boolean;
  accountFlows: LocalAccountFlows;
  authorize: (req: FastifyRequest, reply: FastifyReply, accountId: string, action: Action) => boolean;
  fieldVisibility: (req: FastifyRequest, table: string, accountId: unknown) => SanitizeWriteOptions;
  redact: (table: string, row: Record<string, unknown>, vis: SanitizeWriteOptions) => Record<string, unknown>;
  drainProductAudit: (reply: FastifyReply) => boolean;
  fail: (reply: FastifyReply, error: unknown) => FastifyReply;
  accountFail: (reply: FastifyReply, error: unknown) => FastifyReply;
}

export function registerBatchRoutes(app: FastifyInstance, dependencies: BatchRouteDependencies): void {
  const {
    db,
    store,
    authMode,
    multiAccount,
    optimisticConcurrency,
    accountFlows,
    authorize,
    fieldVisibility: fieldVisibilityFor,
    redact: redactWriteEcho,
    drainProductAudit,
    fail: sendFail,
    accountFail,
  } = dependencies;

  // Transactional batch write — the verb the client sync adapter uses for every save.
  // Body: { ops: BatchOp[] }, already ordered (upserts parent-first, then deletes
  // child-first; see the client's syncOps.diffOps). The whole list is applied in ONE
  // transaction: all-or-nothing. This is what makes a reparent+delete safe — the
  // re-binding upsert commits before the old parent's DELETE cascades, so the cascade
  // finds nothing to take — and guarantees a mid-batch failure rolls back, leaving the
  // prior data intact. Each op reuses the SAME ownsRow / sanitizeWrite / validateWrite the
  // per-entity routes use; one request-scoped state projection is loaded inside the transaction
  // and advanced after each op, so a child validates against a parent a sibling op just upserted.
  app.post("/api/batch", async (req, reply) => {
    const parsed = validateBatchRequest(req, reply);
    if (!parsed) return;
    const { ops, syncOrder } = parsed;
    if (ops.length === 0 && syncOrder === null) {
      return reply.code(200).send({
        ok: true,
        applied: 0,
        changed: 0,
        revisions: [],
        auditWarning: false,
      });
    }
    // Shape validation above established every source. This set bounds validation reads to the
    // account slices the request can actually touch; an ordered empty batch deliberately has no
    // slice but still reaches the lightweight sync-sequence transaction below.
    const affectedAccountIds = new Set<string>();
    for (const op of ops) {
      if (op.table === "accounts") {
        affectedAccountIds.add(op.id);
      } else if (isScopedTable(op.table as keyof typeof TABLES)) {
        affectedAccountIds.add(op.method === "PUT" ? (op.row!.accountId as string) : op.accountId!);
      }
    }
    // P1.5 write gate — PRE-SCAN before the tx opens so the batch is rejected WHOLE (one 403, no
    // partial write) if ANY op targets an account the caller may not write. A scoped PUT derives
    // its accountId from op.row.accountId, a scoped DELETE from op.accountId. The unscoped
    // Account deletion is accepted only by the dedicated erasure route and was rejected during
    // shape validation above, so the generic sync path can never turn a bad diff into tenant
    // destruction. An accounts
    // PUT that is an UPDATE gates 'write'; an accounts PUT that is a CREATE is refused outright
    // when auth is on (→ POST /api/orgs, see ACCOUNT_CREATE_CLOSED_MESSAGE) and stays open ONLY
    // in OFF mode, where the single-company cap (accountCreateCapped) can still deny it — either
    // refusal fails the whole batch, see below. In OFF mode authorize
    // short-circuits true, so the whole loop is a no-op pass for authz; the cap check is NOT part of that no-op — it runs
    // regardless of authMode.
    // Evaluate the single-company cap against the batch's PROJECTED state, not once per op
    // against the same pre-transaction snapshot. Two distinct account creates in an empty DB
    // must be rejected together rather than both passing and committing.
    const hasAccountOperations = ops.some((op) => op.table === "accounts");
    const accountProjection = hasAccountOperations
      ? projectBatchAccounts(db, ops)
      : { count: 0, createsFinalAccount: false };
    // Authenticated account creation is closed on this generic sync route (the loop below
    // returns ACCOUNT_CREATE_CLOSED_MESSAGE). In trusted-local mode, project the *whole* batch
    // before starting the transaction so two creates cannot both pass against the same empty DB.
    if (authMode === "off" && accountProjection.createsFinalAccount && !multiAccount && accountProjection.count > 1) {
      return reply.code(403).send({ error: SINGLE_COMPANY_CAP_MESSAGE });
    }

    const authorizeOperations = (): boolean => authorizeBatchOperations({ ops, db, authMode, req, reply, authorize });
    if (!authorizeOperations()) return;
    // Field visibility, memoized PER REQUEST: fieldVisibilityFor pays an account-port membership
    // query for every timeOff/client/project row, and a batch may carry up to MAX_BATCH_OPS of them
    // — each op would otherwise re-run the identical lookup inside the write tx. Memoizing by
    // accountId is exact, not approximate: the caller (req.user) is fixed for the request, and
    // their role cannot change mid-transaction (tx() serializes on the single SQLite connection
    // membership writes also go through, so no interleaved role edit can land while the batch
    // runs). Unaffected tables short-circuit to the frozen ALL_FIELDS_VISIBLE constant — no
    // lookup, no allocation — so only distinct protected-field accountIds
    // (in practice: one) ever populate the cache.
    const fieldVisCache = new Map<string, SanitizeWriteOptions>();
    const fieldVisFor = (table: string, accountId: unknown): SanitizeWriteOptions => {
      if (!tableHasGatedFields(table) || typeof accountId !== "string") {
        return fieldVisibilityFor(req, table, accountId); // no-lookup short-circuits; nothing to cache
      }
      const cached = fieldVisCache.get(accountId);
      if (cached) return cached;
      const vis = fieldVisibilityFor(req, table, accountId);
      fieldVisCache.set(accountId, vis);
      return vis;
    };
    const revisions: BatchRevision[] = [];
    const lifecycleArchives: Array<{ table: string; id: string; archived: boolean }> = [];
    try {
      const { supersededSyncBatch, auditRecords } = await runBatch({
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
      });
      if (supersededSyncBatch) {
        return reply.code(200).send({
          ok: true,
          applied: ops.length,
          changed: 0,
          revisions: [],
          archives: [],
          superseded: true,
          auditWarning: false,
        });
      }
      const auditFailed = !drainProductAudit(reply);
      if (auditFailed) reply.header("x-capacitylens-audit-warning", "true");
      // `applied` is the atomic receipt count: every submitted op was accepted and processed, so
      // the sync client can require equality with ops.length. `changed` counts submitted mutations
      // and excludes idempotent deletes; revisions may additionally report implicit allocation
      // rewrites caused by an activity kind change.
      return reply.code(200).send({
        ok: true,
        applied: ops.length,
        changed: auditRecords.filter((record) => record !== null).length,
        revisions,
        archives: lifecycleArchives,
        auditWarning: auditFailed,
      });
    } catch (err) {
      if (err instanceof BatchAuthorizationResponseSent) return;
      // Stale-write conflict (optimistic concurrency): mirror the direct PUT route's 409 +
      // `current` payload. tx() has already rolled the WHOLE batch back by the time this runs
      // (all-or-nothing), so no op from the conflicted batch persisted — the client re-syncs
      // from `current`. Checked BEFORE sendFail, which would misclassify it as a 500.
      if (err instanceof StaleWriteError) {
        return reply.code(409).send({ error: err.message, current: err.current });
      }
      return err instanceof AccountContractError ? accountFail(reply, err) : sendFail(reply, err);
    }
  });
}
