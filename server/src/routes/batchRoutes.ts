import type { AuthorizeBasicInput } from "./routeShared";
import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { LocalAccountFlows } from "../accounts/createLocalAccountFlows";
import type { AccountMode } from "../auth";
import { type Db } from "../db";
import { hasGatedFields, type SanitizeWriteOptions } from "../fieldPolicy";
import type { TenantStore } from "../tenantStore";
import { SINGLE_COMPANY_CAP_MESSAGE } from "./accountEntityRoutes";
import { isScopedTable } from "./routeShared";

import { authorizeBatchOperations, projectBatchAccounts } from "./batch/authorize";
import { BatchAuthorizationResponseSent, StaleWriteError } from "./batch/errors";
import { runBatch } from "./batch/runBatch";
import { type BatchOp, type BatchRevision } from "./batch/types";
import { parseBatchRequest } from "./batch/validateRequest";
export { MAX_BATCH_OPS } from "./batch/types";

export interface BatchRouteDependencies {
  db: Db;
  store: TenantStore;
  authMode: AccountMode;
  multiAccount: boolean;
  optimisticConcurrency: boolean;
  accountFlows: LocalAccountFlows;
  authorize: (input: AuthorizeBasicInput) => boolean;
  fieldVisibility: (req: FastifyRequest, table: string, accountId: unknown) => SanitizeWriteOptions;
  redact: (table: string, row: Record<string, unknown>, visibility: SanitizeWriteOptions) => Record<string, unknown>;
  drainProductAudit: (reply: FastifyReply) => boolean;
  fail: (reply: FastifyReply, error: unknown) => FastifyReply;
  accountFail: (reply: FastifyReply, error: unknown) => FastifyReply;
}

function listAffectedAccountIds(ops: BatchOp[]): Set<string> {
  const accountIds = new Set<string>();
  for (const op of ops) {
    if (op.table === "accounts") {
      accountIds.add(op.id);
      continue;
    }
    if (!isScopedTable(op.table)) continue;
    const accountId = op.method === "PUT" ? op.row?.accountId : op.accountId;
    if (typeof accountId !== "string") {
      throw new Error("A validated scoped batch operation requires an account ID.");
    }
    accountIds.add(accountId);
  }
  return accountIds;
}

function createFieldVisibilityResolver(
  req: FastifyRequest,
  fieldVisibilityFor: BatchRouteDependencies["fieldVisibility"],
): (table: string, accountId: unknown) => SanitizeWriteOptions {
  // Membership-derived visibility is stable for the request because the transaction serializes
  // membership writes on the same SQLite connection. Cache only gated tables with string IDs.
  const visibilityByAccountId = new Map<string, SanitizeWriteOptions>();
  return (table, accountId) => {
    if (!hasGatedFields(table) || typeof accountId !== "string") {
      return fieldVisibilityFor(req, table, accountId);
    }
    const cached = visibilityByAccountId.get(accountId);
    if (cached) return cached;
    const visibility = fieldVisibilityFor(req, table, accountId);
    visibilityByAccountId.set(accountId, visibility);
    return visibility;
  };
}

function sendEmptyBatch(reply: FastifyReply): FastifyReply {
  return reply.code(200).send({
    ok: true,
    applied: 0,
    changed: 0,
    revisions: [],
    auditWarning: false,
  });
}

function sendSupersededBatch(reply: FastifyReply, applied: number): FastifyReply {
  return reply.code(200).send({
    ok: true,
    applied,
    changed: 0,
    revisions: [],
    archives: [],
    superseded: true,
    auditWarning: false,
  });
}

function sendAppliedBatch(parameters: {
  reply: FastifyReply;
  applied: number;
  changed: number;
  revisions: BatchRevision[];
  lifecycleArchives: Array<{ table: string; id: string; archived: boolean }>;
  drainProductAudit: BatchRouteDependencies["drainProductAudit"];
}): FastifyReply {
  const { reply, applied, changed, revisions, lifecycleArchives, drainProductAudit } = parameters;
  const auditFailed = !drainProductAudit(reply);
  if (auditFailed) reply.header("x-capacitylens-audit-warning", "true");
  return reply.code(200).send({
    ok: true,
    applied,
    changed,
    revisions,
    archives: lifecycleArchives,
    auditWarning: auditFailed,
  });
}

function sendBatchError(
  reply: FastifyReply,
  error: unknown,
  dependencies: Pick<BatchRouteDependencies, "accountFail" | "fail">,
): FastifyReply | undefined {
  if (error instanceof BatchAuthorizationResponseSent) return undefined;
  if (error instanceof StaleWriteError) {
    return reply.code(409).send({ error: error.message, current: error.current });
  }
  return error instanceof AccountContractError
    ? dependencies.accountFail(reply, error)
    : dependencies.fail(reply, error);
}

function createBatchHandler(dependencies: BatchRouteDependencies) {
  const { db, authMode, multiAccount, authorize } = dependencies;

  // Transactional batch write — the verb the client sync adapter uses for every save.
  // Body: { ops: BatchOp[] }, already ordered (upserts parent-first, then deletes
  // child-first; see the client's syncOps.diffOps). The whole list is applied in ONE
  // transaction: all-or-nothing. This is what makes a reparent+delete safe — the
  // re-binding upsert commits before the old parent's DELETE cascades, so the cascade
  // finds nothing to take — and guarantees a mid-batch failure rolls back, leaving the
  // prior data intact. Each op reuses the SAME ownsRow / sanitizeWrite / validateWrite the
  // per-entity routes use; one request-scoped state projection is loaded inside the transaction
  // and advanced after each op, so a child validates against a parent a sibling op just upserted.
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = parseBatchRequest(req, reply);
    if (!parsed) return;
    const { ops, syncOrder } = parsed;
    if (ops.length === 0 && syncOrder === null) return sendEmptyBatch(reply);
    // Shape validation above established every source. This set bounds validation reads to the
    // account slices the request can actually touch; an ordered empty batch deliberately has no
    // slice but still reaches the lightweight sync-sequence transaction below.
    const affectedAccountIds = listAffectedAccountIds(ops);
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

    const authorizeOperations = () => authorizeBatchOperations({ ops, db, authMode, req, reply, authorize });
    if (!authorizeOperations()) return;
    const fieldVisFor = createFieldVisibilityResolver(req, dependencies.fieldVisibility);
    const revisions: BatchRevision[] = [];
    const lifecycleArchives: Array<{ table: string; id: string; archived: boolean }> = [];
    try {
      const result = await runBatch({
        ops,
        syncOrder,
        req,
        db,
        store: dependencies.store,
        optimisticConcurrency: dependencies.optimisticConcurrency,
        multiAccount,
        accountFlows: dependencies.accountFlows,
        fieldVisFor,
        redactWriteEcho: dependencies.redact,
        revisions,
        lifecycleArchives,
        affectedAccountIds,
        hasAccountOperations,
        authorizeOperations,
      });
      if (result.kind === "superseded") {
        return sendSupersededBatch(reply, ops.length);
      }
      // `applied` is the atomic receipt count: every submitted op was accepted and processed, so
      // the sync client can require equality with ops.length. `changed` counts submitted mutations
      // and excludes idempotent deletes; revisions may additionally report implicit allocation
      // rewrites caused by an activity kind change.
      return sendAppliedBatch({
        reply,
        applied: ops.length,
        changed: result.auditRecords.filter((record) => record !== null).length,
        revisions,
        lifecycleArchives,
        drainProductAudit: dependencies.drainProductAudit,
      });
    } catch (error) {
      return sendBatchError(reply, error, dependencies);
    }
  };
}

export function registerBatchRoutes(app: FastifyInstance, dependencies: BatchRouteDependencies): void {
  app.post("/api/batch", createBatchHandler(dependencies));
}
