import type { AuthorizeRouteInput } from "./routeShared";
import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { LocalAccountFlows } from "../accounts/createLocalAccountFlows";
import type { AccountMode } from "../auth";
import type { Db } from "../db";
import { hasGatedFields } from "../fieldPolicy";
import type { SanitizeWriteOptions } from "../fieldPolicy";
import type { AccountStore } from "../accountStore";
import { SINGLE_COMPANY_CAP_MESSAGE } from "./accountEntityRoutes";
import { isScopedTable } from "./routeShared";

import { authorizeBatchOperations, projectBatchAccounts } from "./batch/authorize";
import { BatchAuthorizationResponseSent, StaleWriteError } from "./batch/errors";
import { runBatch } from "./batch/runBatch";
import type { BatchOp, BatchRevision } from "./batch/types";
import { parseBatchRequest } from "./batch/validateRequest";
import { REPLY_ERRORS } from "./replyErrors";
export { MAX_BATCH_OPS } from "./batch/types";

/** Dependencies required by the batch HTTP route. */
export interface BatchRouteDependencies {
  db: Db;
  store: AccountStore;
  authMode: AccountMode;
  multiAccount: boolean;
  optimisticConcurrency: boolean;
  accountFlows: LocalAccountFlows;
  authorize: (input: AuthorizeRouteInput) => boolean;
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
    const accountId = op.method === "PUT" ? op.row.accountId : op.accountId;
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
    return reply.code(409).send({ error: REPLY_ERRORS.staleWrite, current: error.current });
  }
  return error instanceof AccountContractError
    ? dependencies.accountFail(reply, error)
    : dependencies.fail(reply, error);
}

function createBatchHandler(dependencies: BatchRouteDependencies) {
  const { db, authMode, multiAccount, authorize } = dependencies;

  // Transactional batch write, the verb the client sync adapter uses for every save.
  // Body: { ops: BatchOp[] }, already ordered (upserts parent-first, then deletes
  // child-first; see the client's syncOps.diffOps). The whole list is applied in one
  // transaction: all-or-nothing. This is what makes a reparent+delete safe, the
  // re-binding upsert commits before the old parent's DELETE cascades, so the cascade
  // finds nothing to take, and guarantees a mid-batch failure rolls back, leaving the
  // prior data intact. Each op reuses the same ownsRow / sanitizeWrite / validateWrite the
  // per-entity routes use; one request-scoped state projection is loaded inside the transaction
  // and advanced after each op, so a child validates against a parent a sibling op just upserted.
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = parseBatchRequest(req);
    if (parsed.kind === "invalid") return reply.code(parsed.failure.status).send({ error: parsed.failure.error });
    const { ops, syncOrder } = parsed.value;
    if (ops.length === 0 && syncOrder === null) return sendEmptyBatch(reply);
    // Shape validation above established every source. This set bounds validation reads to the
    // account slices the request can actually touch; an ordered empty batch deliberately has no
    // slice but still reaches the lightweight sync-sequence transaction below.
    const affectedAccountIds = listAffectedAccountIds(ops);
    // Authorize every affected tenant before mutation, then recheck after acquiring locks.
    // Generic account creation is trusted-local only and respects the batch’s projected company count.
    // Account erasure remains on its dedicated route so a sync diff cannot delete a tenant.
    const hasAccountOperations = ops.some((op) => op.table === "accounts");
    const accountProjection = hasAccountOperations
      ? projectBatchAccounts(db, ops)
      : { count: 0, createsFinalAccount: false };
    // Project the whole trusted-local batch so two company creates cannot both pass against one empty snapshot.
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
      // Preserve an already-sent refusal, report stale writes as conflicts, and redact other failures after transactional work has unwound.
      return sendBatchError(reply, error, dependencies);
    }
  };
}

/** Registers the atomic batch endpoint. */
export function registerBatchRoutes(app: FastifyInstance, dependencies: BatchRouteDependencies): void {
  app.post("/api/batch", createBatchHandler(dependencies));
}
