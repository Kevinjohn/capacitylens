import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AccountContractError } from "@capacitylens/shared/account/errors";
import { isBrowserSyncSessionId } from "@capacitylens/shared/account/validation";
import type { Action } from "@capacitylens/shared/domain/access";
import { archive } from "@capacitylens/shared/domain/lifecycle";
import { buildInternalClient, isBuiltinClient } from "@capacitylens/shared/data/internalClient";
import { APP_DATA_KEYS, emptyAppData, type AppData, type AppDataKey } from "@capacitylens/shared/types/entities";
import type { AuditRecord } from "../audit";
import { enqueueAudit } from "../auditOutbox";
import type { AuthMode } from "../auth";
import type { LocalAccountFlows } from "../accounts/localAccountFlows";
import { BatchStateProjection } from "../batchProjection";
import { deleteRow, getRow, type Db, upsertRow } from "../db";
import { tableHasGatedFields, type SanitizeWriteOptions } from "../fieldPolicy";
import { nextServerRevision } from "../revision";
import { isSameSessionSuccessor, isSupersededSyncBatch, recordAppliedSyncBatch, type SyncOrder } from "../syncOrdering";
import { TABLES } from "../tables";
import type { LifecycleRow, TenantStore } from "../tenantStore";
import { tx } from "../txn";
import {
  acceptedFieldNames,
  appliedRequestedFieldNames,
  sanitizeWrite,
  validateWrite,
  ValidationError,
} from "../validate";
import {
  builtinInternalWriteGuard,
  checkEntityWriteBody,
  FULL_SLICE_READ,
  generatedBuiltinReplacement,
  replaceGeneratedBuiltin,
  stampServerRevision,
} from "../writePipeline";
import {
  ACCOUNT_CREATE_CLOSED_MESSAGE,
  ACCOUNT_FROZEN_FIELDS_MESSAGE,
  SINGLE_COMPANY_CAP_MESSAGE,
  accountFieldsFrozen,
  countAccounts,
} from "./accountEntityRoutes";
import { isKnownTable, isLifecycleEntity, isScopedTable, isStaleWrite, ownsRow, writeActivityRow } from "./routeShared";

// Cap on ops per POST /api/batch request (the MAX_IMPORT_RECORDS precedent, applied to the sync
// path). BODY_LIMIT bounds request BYTES, but not request WORK: every operation is sanitized,
// authorized, validated and applied to the in-memory projection. The transaction reads each
// affected account slice once, then indexed point/reverse lookups keep per-op validation and
// projection updates proportional to each operation's referenced/affected rows rather than the
// whole tenant. Op COUNT is therefore the remaining request-controlled multiplier. 5 000 is
// generous headroom over the largest realistic full-slice diff the client sync adapter produces
// (a whole busy agency's slice is low-thousands of rows) while bounding a crafted/looping flood.
// The inclusive boundary integration test applies 5 000 real existing-row updates and enforces a
// four-second handler budget under the supported Node 24 gate, leaving headroom below the packaged
// five-second container healthcheck timeout. Keep that budget, this cap and the client's matching
// MAX_OPS_PER_BATCH in lockstep; an in-process queue cannot shorten one synchronous SQLite turn.
// Checked BEFORE the pre-scan and tx, so an over-cap batch writes nothing.
// Exported for the test that pins the boundary.
export const MAX_BATCH_OPS = 5000;

interface BatchOp {
  method: "PUT" | "DELETE" | "ARCHIVE";
  table: string;
  id: string;
  row?: Record<string, unknown>;
  accountId?: string;
  updatedAt?: string;
}

/** Append one complete account slice to a request-local validation projection. */
function appendAppDataSlice(target: AppData, slice: AppData): void {
  for (const key of APP_DATA_KEYS) {
    const targetRows = target[key] as unknown[];
    targetRows.push(...slice[key]);
  }
}

/** A client may echo the deterministic Internal row immediately after creating its account in the
 * same batch. Accept that protected duplicate only when every stored client field is already the
 * exact server-generated value. Persistence timestamps are server-owned, so compare them after
 * pinning the no-op candidate to the generated revision returned in the receipt. */
function matchesMintedInternalClient(existing: Record<string, unknown>, incoming: Record<string, unknown>): boolean {
  const normalized: Record<string, unknown> = {
    ...incoming,
    createdAt: existing.createdAt,
    updatedAt: existing.updatedAt,
  };
  return TABLES.clients.columns.every(({ name }) => normalized[name] === existing[name]);
}

/** Batch-internal stale-write signal (optimistic concurrency, fix parity with the direct PUT
 * route). Carries the STORED row so the batch handler can send the direct route's exact 409
 * shape (`{ error, current }`). It is thrown from INSIDE tx(), so by construction the whole
 * batch has already rolled back by the time the handler catches it — all-or-nothing, no op from
 * the conflicted batch persists. NOT a ValidationError: this is a conflict (409), not a
 * malformed request (400), and it must never be re-classified by statusFor. */
class StaleWriteError extends Error {
  constructor(readonly current: Record<string, unknown>) {
    super("The record was modified more recently on the server.");
    this.name = "StaleWriteError";
  }
}

/** Internal control signal: a post-lock batch authorization recheck already sent its refusal. */
class BatchAuthorizationResponseSent extends Error {}

/** Project the final top-level account count for an already shape-validated batch. */
function projectBatchAccounts(db: Db, ops: BatchOp[]): { count: number; createsFinalAccount: boolean } {
  let count = countAccounts(db);
  const originalExistence = new Map<string, boolean>();
  const projectedExistence = new Map<string, boolean>();
  for (const op of ops) {
    if (op.table !== "accounts") continue;
    let exists = projectedExistence.get(op.id);
    if (exists === undefined) {
      exists = Boolean(getRow(db, "accounts", op.id));
      originalExistence.set(op.id, exists);
    }
    if (op.method === "PUT" && !exists) count += 1;
    if (op.method === "DELETE" && exists) count -= 1;
    projectedExistence.set(op.id, op.method === "PUT");
  }
  return {
    count,
    createsFinalAccount: [...projectedExistence].some(([id, exists]) => exists && originalExistence.get(id) === false),
  };
}

interface ParsedBatchRequest {
  ops: BatchOp[];
  syncOrder: SyncOrder | null;
}

function validateBatchRequest(req: FastifyRequest, reply: FastifyReply): ParsedBatchRequest | null {
  const body = req.body as { ops?: unknown };
  if (!body || !Array.isArray(body.ops)) {
    reply.code(400).send({ error: "ops array is required" });
    return null;
  }
  const ops = body.ops as BatchOp[];
  const rawSyncSession = req.headers["x-capacitylens-sync-session"];
  const rawSyncSequence = req.headers["x-capacitylens-sync-sequence"];
  let syncOrder: SyncOrder | null = null;
  if (rawSyncSession !== undefined || rawSyncSequence !== undefined) {
    const sequence =
      typeof rawSyncSequence === "string" && /^[1-9]\d{0,15}$/.test(rawSyncSequence)
        ? Number(rawSyncSequence)
        : Number.NaN;
    if (!isBrowserSyncSessionId(rawSyncSession) || !Number.isSafeInteger(sequence)) {
      reply.code(400).send({ error: "Invalid browser sync ordering headers." });
      return null;
    }
    syncOrder = { sessionId: rawSyncSession, sequence };
  }
  // Ordered-op updatedAt guard shared by the PUT/DELETE/ARCHIVE branches of the pre-scan below —
  // a no-op unless this request carries sync ordering headers (closes over syncOrder above).
  const requireOrderedUpdatedAt = (value: unknown, verbLabel: string): { status: number; error: string } | null =>
    syncOrder && typeof value !== "string"
      ? { status: 400, error: `An ordered ${verbLabel} op needs a string updatedAt revision.` }
      : null;
  // MAX_BATCH_OPS (see its doc comment) bounds the per-operation multiplier; the initial
  // projection read still scales once with each affected account's slice.
  // Rejected before the pre-scan and transaction, so an over-cap batch does no per-op work.
  if (ops.length > MAX_BATCH_OPS) {
    reply.code(400).send({
      error: `A batch may contain at most ${MAX_BATCH_OPS} operations.`,
    });
    return null;
  }
  for (const rawOp of ops as unknown[]) {
    if (!rawOp || typeof rawOp !== "object" || Array.isArray(rawOp)) {
      reply.code(400).send({ error: "Each op must be an object." });
      return null;
    }
    const op = rawOp as Partial<BatchOp>;
    if (op.method !== "PUT" && op.method !== "DELETE" && op.method !== "ARCHIVE") {
      reply.code(400).send({ error: `Unknown op method: ${String(op.method)}` });
      return null;
    }
    if (typeof op.table !== "string" || !isKnownTable(op.table) || typeof op.id !== "string") {
      reply.code(400).send({ error: "Each op needs a known table and string id." });
      return null;
    }
    if (op.method === "PUT") {
      const rejection = checkEntityWriteBody("replace", op.table, op.row, op.id, isScopedTable(op.table));
      if (rejection) {
        reply.code(rejection.status).send({ error: rejection.error });
        return null;
      }
      const row = op.row as Record<string, unknown>;
      const orderedRejection = requireOrderedUpdatedAt(row.updatedAt, "PUT");
      if (orderedRejection) {
        reply.code(orderedRejection.status).send({ error: orderedRejection.error });
        return null;
      }
    } else if (op.method === "DELETE") {
      if (isLifecycleEntity(op.table)) {
        reply.code(400).send({
          error: "Use the dedicated lifecycle endpoints for lifecycle entities.",
        });
        return null;
      }
      if (op.table === "accounts") {
        reply.code(400).send({ error: "Use the dedicated company deletion endpoint." });
        return null;
      }
      if (isScopedTable(op.table) && typeof op.accountId !== "string") {
        reply.code(400).send({ error: "A scoped DELETE op needs a string accountId." });
        return null;
      }
      const orderedRejection = requireOrderedUpdatedAt(op.updatedAt, "DELETE");
      if (orderedRejection) {
        reply.code(orderedRejection.status).send({ error: orderedRejection.error });
        return null;
      }
    } else {
      if (!isLifecycleEntity(op.table)) {
        reply.code(400).send({ error: "ARCHIVE is supported only for lifecycle entities." });
        return null;
      }
      if (typeof op.accountId !== "string") {
        reply.code(400).send({ error: "An ARCHIVE op needs a string accountId." });
        return null;
      }
      const orderedRejection = requireOrderedUpdatedAt(op.updatedAt, "ARCHIVE");
      if (orderedRejection) {
        reply.code(orderedRejection.status).send({ error: orderedRejection.error });
        return null;
      }
    }
  }
  return { ops, syncOrder };
}

function authorizeBatchOperations(parameters: {
  ops: BatchOp[];
  db: Db;
  authMode: AuthMode;
  req: FastifyRequest;
  reply: FastifyReply;
  authorize: BatchRouteDependencies["authorize"];
}): boolean {
  const { ops, db, authMode, req, reply, authorize } = parameters;
  // This function is invoked once before waiting for workspace locks and again after lock
  // acquisition. Keep the cache local so those remain independent authorization snapshots,
  // while repeated operations for the same account/action do not repeat the identical
  // membership query within either snapshot. Only successful checks are cached; a denial
  // sends its response and ends the pass immediately.
  const authorizedActions = new Map<string, Set<Action>>();
  const authorizeOnce = (accountId: string, action: Action): boolean => {
    const actions = authorizedActions.get(accountId);
    if (actions?.has(action)) return true;
    if (!authorize(req, reply, accountId, action)) return false;
    if (actions) actions.add(action);
    else authorizedActions.set(accountId, new Set([action]));
    return true;
  };

  for (const op of ops) {
    if (op?.table === "accounts" && op.method === "PUT") {
      const existingAccount = getRow(db, "accounts", op.id);
      if (existingAccount) {
        if (!authorizeOnce(op.id, "write")) return false;
      } else if (authMode !== "off") {
        reply.code(403).send({ error: ACCOUNT_CREATE_CLOSED_MESSAGE });
        return false;
      }
      // OFF-mode creates are checked against the projected final set and rechecked by the
      // provisioning policy inside the transaction.
      continue;
    }
    if (!isScopedTable(op.table)) {
      reply.code(403).send({
        error: "No batch-write policy is defined for this entity.",
      });
      return false;
    }
    const accountId = op.method === "PUT" ? (op.row as { accountId?: string } | undefined)?.accountId : op.accountId;
    const action: Action =
      op.method === "PUT" && op.table === "clients" && (op.row as { builtin?: unknown } | undefined)?.builtin === true
        ? "manageInternalClient"
        : "write";
    if (!authorizeOnce(accountId as string, action)) return false;
  }
  return true;
}

interface BatchRevision {
  table: string;
  id: string;
  createdAt: string;
  updatedAt: string;
  rewrite?: true;
}

interface ApplyBatchOperationParameters {
  opIndex: number;
  op: BatchOp;
  req: FastifyRequest;
  db: Db;
  store: TenantStore;
  state: AppData;
  projection: BatchStateProjection;
  mintedInternalIds: Set<string>;
  revisions: BatchRevision[];
  auditRecords: Array<AuditRecord | null>;
  lifecycleArchives: Array<{ table: string; id: string; archived: boolean }>;
  syncOrder: SyncOrder | null;
  optimisticConcurrency: boolean;
  multiAccount: boolean;
  projectedWorkspaceCount: number;
  accountFlows: LocalAccountFlows;
  fieldVisFor: (table: string, accountId: unknown) => SanitizeWriteOptions;
  redactWriteEcho: BatchRouteDependencies["redact"];
}

function applyBatchOperation(parameters: ApplyBatchOperationParameters): void {
  const {
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
  } = parameters;
  const { method, table, id } = op;
  // Shape, method, known-table and id validation completed before authorization and before
  // opening this transaction. This loop owns only state-dependent validation and mutation.
  if (method === "PUT") {
    const row = op.row;
    if (!row || typeof row !== "object" || (row as { id?: unknown }).id !== id) {
      throw new ValidationError("Each PUT op needs a row whose id matches the op id.");
    }
    // accountId is immutable (ownsRow): a write must not re-home an existing row.
    const persistedExisting = getRow(db, table, id);
    const existing =
      table === "allocations"
        ? (projection.row("allocations", id) as Record<string, unknown> | undefined)
        : persistedExisting;
    // Built-in Internal guard (Finding 7 — ONE implementation). The batch's own minted-
    // Internal exception accepts only the canonical duplicate a client emitted alongside
    // the account create; malformed or re-homed bodies roll the whole batch back.
    if (table === "clients" && existing?.builtin === true && mintedInternalIds.has(id)) {
      if (!matchesMintedInternalClient(existing, row as Record<string, unknown>)) {
        throw new ValidationError("The same-batch built-in Internal client must match the generated server row.");
      }
      revisions.push({
        table,
        id,
        createdAt: existing.createdAt as string,
        updatedAt: existing.updatedAt as string,
      });
      // This submitted operation is acknowledged for sync/revision purposes, but
      // the preceding account create already minted the identical row. Do not
      // report or audit a second state change that never happened.
      if (auditRecords[opIndex]) {
        auditRecords[opIndex] = null;
      }
      return;
    }
    const builtinRejection = builtinInternalWriteGuard("replace", table, existing, row as Record<string, unknown>);
    if (builtinRejection) throw new ValidationError(builtinRejection.error);
    if (!ownsRow(existing, (row as { accountId?: unknown }).accountId)) {
      throw new AccountContractError({
        code: "NOT_FOUND",
        message: "Not found",
        retryable: false,
      });
    }
    const sanitizedRow = sanitizeWrite(
      table,
      row as Record<string, unknown>,
      existing,
      fieldVisFor(table, (row as { accountId?: unknown }).accountId),
    );
    // language/weekStartsOn/timezone are FROZEN after creation (P1.14). Match the
    // direct routes' 409 so the sync client takes its authoritative-reload path
    // instead of retrying the same state-dependent conflict indefinitely.
    if (table === "accounts" && accountFieldsFrozen(existing, sanitizedRow)) {
      throw new AccountContractError({
        code: "CONFLICT",
        message: ACCOUNT_FROZEN_FIELDS_MESSAGE,
        retryable: false,
      });
    }
    // Optimistic concurrency is default-on for generic writes and mandatory for an
    // ordered browser batch. The stale-write refusal is isStaleWrite, the SAME predicate
    // the direct PUT route runs, so the two paths can't drift. Thrown
    // (not replied) because we are inside tx(): the throw aborts the transaction, so
    // the WHOLE batch rolls back, and the catch below maps it to the direct route's
    // 409 + { current } shape.
    if (
      (optimisticConcurrency || syncOrder !== null) &&
      isStaleWrite(persistedExisting, row as Record<string, unknown>) &&
      !(syncOrder && isSameSessionSuccessor(db, syncOrder, table, id, persistedExisting))
    ) {
      // The 409's `current` payload is a READ of the stored row: redact the time-off
      // note for a note-blind writer, exactly like the write echo (P1.6) — the conflict
      // path must not hand an editor the very field readSlice redacts.
      throw new StaleWriteError(
        redactWriteEcho(table, persistedExisting, fieldVisFor(table, (row as { accountId?: unknown }).accountId)),
      );
    }
    // P1.6: pin the time-off `note` for a note-blind writer — the batch is the client's
    // REAL save path, so an editor's redacted round-trip lands here (see sanitizeWrite).
    const clean = stampServerRevision(sanitizedRow, existing);
    const auditRecord = auditRecords[opIndex];
    if (auditRecord) {
      auditRecord.changedFields = appliedRequestedFieldNames(table, row, existing, clean);
    }
    const generatedReplacement = generatedBuiltinReplacement(state, table, clean);
    if (table === "accounts" && !existing) {
      // Evaluate provisioning policy before inserting the account, against the final
      // count of the whole atomic batch. The surrounding application-wide lock is shared
      // with /api/orgs; any later storage failure rolls this membership write back.
      accountFlows.provisionWorkspaceInExistingTransaction({
        workspaceId: id,
        principalId: req.accountActor!.principalId,
        joinedAt: clean.createdAt as string,
        multiWorkspace: multiAccount,
        projectedWorkspaceCount,
      });
    }
    if (generatedReplacement) {
      replaceGeneratedBuiltin(db, state, generatedReplacement, clean);
      projection.replaceGeneratedBuiltin(generatedReplacement, clean);
    } else {
      validateWrite(state, table, clean, existing, projection);
      if (table === "activities") {
        writeActivityRow(db, projection, clean, existing);
      } else {
        upsertRow(db, table, clean);
        projection.upsert(table as AppDataKey, clean);
      }
    }
    if (table === "accounts" && !existing) {
      const internalClient = buildInternalClient(id, clean.createdAt as string) as unknown as Record<string, unknown>;
      upsertRow(db, "clients", internalClient);
      projection.upsert("clients", internalClient);
      mintedInternalIds.add(internalClient.id as string);
    }
    revisions.push({
      table,
      id,
      createdAt: clean.createdAt as string,
      updatedAt: clean.updatedAt as string,
    });
  } else if (method === "ARCHIVE") {
    if (!isLifecycleEntity(table)) {
      throw new ValidationError("ARCHIVE is supported only for lifecycle entities.");
    }
    const existing = getRow(db, table, id);
    if (!ownsRow(existing, op.accountId)) {
      throw new AccountContractError({
        code: "NOT_FOUND",
        message: "Not found",
        retryable: false,
      });
    }
    if (!existing) {
      lifecycleArchives.push({ table, id, archived: false });
      return;
    }
    if (table === "clients" && isBuiltinClient(existing as never)) {
      throw new ValidationError("The built-in Internal client cannot be archived.");
    }
    if (
      syncOrder &&
      isStaleWrite(existing, { updatedAt: op.updatedAt }) &&
      !isSameSessionSuccessor(db, syncOrder, table, id, existing)
    ) {
      throw new StaleWriteError(redactWriteEcho(table, existing, fieldVisFor(table, op.accountId ?? id)));
    }
    if (existing.archivedAt != null || existing.deletedAt != null) {
      if (auditRecords[opIndex]) {
        auditRecords[opIndex] = null;
      }
      lifecycleArchives.push({ table, id, archived: existing.archivedAt != null });
      return;
    }
    const now = nextServerRevision(existing.updatedAt);
    const archived = {
      ...archive(existing as unknown as LifecycleRow, now),
      updatedAt: now,
    };
    store.writeLifecycleRow(op.accountId!, table, archived);
    projection.upsert(table as AppDataKey, archived as unknown as Record<string, unknown>);
    lifecycleArchives.push({ table, id, archived: true });
  } else if (method === "DELETE") {
    if (table === "accounts") {
      throw new ValidationError("Use the dedicated company deletion endpoint.");
    }
    const existing = getRow(db, table, id);
    // Scoped deletes assert ownership (same rule as the DELETE route).
    if (isScopedTable(table)) {
      if (typeof op.accountId !== "string") {
        throw new ValidationError("accountId is required to delete a scoped record.");
      }
      if (!ownsRow(existing, op.accountId)) {
        throw new AccountContractError({
          code: "NOT_FOUND",
          message: "Not found",
          retryable: false,
        });
      }
    }
    if (
      syncOrder &&
      isStaleWrite(existing, { updatedAt: op.updatedAt }) &&
      !isSameSessionSuccessor(db, syncOrder, table, id, existing)
    ) {
      throw new StaleWriteError(redactWriteEcho(table, existing, fieldVisFor(table, op.accountId ?? id)));
    }
    deleteRow(db, table, id);
    projection.delete(table as AppDataKey, id);
  } else {
    throw new ValidationError(`Unknown op method: ${String(method)}`);
  }
}

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
    let supersededSyncBatch = false;
    // Assigned inside the lock/tx closure below, but read at response shaping outside it — declared
    // here (like revisions/lifecycleArchives above) so it stays in scope at both points. `changed`
    // is derived from this at response time rather than hand-counted, so a null-out site can never
    // drift from what's actually reported.
    let auditRecords: Array<AuditRecord | null> = [];
    try {
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
                      op.table === "accounts"
                        ? op.id
                        : op.method === "PUT"
                          ? (op.row!.accountId as string)
                          : op.accountId!,
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
