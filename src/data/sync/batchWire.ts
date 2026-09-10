import { isDomainErrorCode } from "@capacitylens/shared/domain/errors";
import { isLifecycleEntityKey } from "@capacitylens/shared/domain/lifecycle";
import { MASQUERADE_ERROR_CODES } from "@capacitylens/shared/domain/masquerade";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import { announceAuditWarning, noteAuditWarning } from "../../lib/auditWarning";
import { extractApiErrorMessage } from "../../lib/readApiError";
import { API_BULK_TIMEOUT_MS, isTransportFailure, readMasqueradeErrorCode } from "../requestTimeout";
import { type Op } from "../syncOps";
import {
  BatchCommitUncertainError,
  BatchConflictError,
  BatchMasqueradeReadOnlyError,
  BatchTooLargeError,
  BatchValidationError,
  KEEPALIVE_BODY_BUDGET,
  KeepaliveNotDispatchedError,
  MAX_OPS_PER_BATCH,
} from "./batchErrors";
import {
  buildRowKey,
  createSafeResponseError,
  warnCompatibilityOnce,
  type BatchCommitReceipt,
  type CommittedRevision,
} from "./revisions";
import type { SyncState } from "./state";

// Apply the complete ordered diff as ONE request and therefore ONE SQLite transaction. An
// over-limit diff is never split into separately committed prefixes.
export function applyBatch(
  state: SyncState,
  ops: Op[],
  options?: { keepalive?: boolean; archiveLifecycleDeletes?: boolean },
): Promise<BatchCommitReceipt> {
  return dispatchPreparedBatch({
    state: state,
    body: prepareBatchBody(state, ops, options),
    ops: ops,
    ...(options ? { options } : {}),
  });
}

/** Validate and serialize before a teardown dispatches any ordering-dependent sibling request. */
export function prepareBatchBody(
  state: SyncState,
  ops: Op[],
  options?: { keepalive?: boolean; archiveLifecycleDeletes?: boolean },
): string {
  if (ops.length > MAX_OPS_PER_BATCH) {
    throw new BatchTooLargeError(`Atomic sync exceeds the ${MAX_OPS_PER_BATCH}-operation server limit.`);
  }
  // Rebase PUT preconditions, then serialize ONCE — the same body feeds both the keepalive
  // byte-budget check and the request, so a large batch isn't JSON.stringified twice per save.
  const wireOps = addResourceAvailabilityClearMarkers(state, rebaseForWire(state, ops)).map((op) =>
    options?.archiveLifecycleDeletes && op.method === "DELETE" && isLifecycleEntityKey(op.table)
      ? { ...op, method: "ARCHIVE" }
      : op,
  );
  const body = JSON.stringify({ ops: wireOps });
  if (options?.keepalive && new TextEncoder().encode(body).byteLength > KEEPALIVE_BODY_BUDGET) {
    throw new KeepaliveNotDispatchedError("The pending change was too large for a page-teardown keepalive request.");
  }
  return body;
}

type WireOp = Omit<Op, "row"> & { row?: Record<string, unknown> };

function addResourceAvailabilityClearMarkers(state: SyncState, ops: Op[]): WireOp[] {
  const previousResources = new Map(state.lastSynced.resources.map((resource) => [resource.id, resource]));
  return ops.map((op) => {
    const wireOp: WireOp = { ...op, ...(op.row ? { row: { ...op.row } } : {}) };
    if (op.method !== "PUT" || op.table !== "resources" || !wireOp.row) return wireOp;
    const previous = previousResources.get(op.id);
    if (!previous) return wireOp;
    for (const field of ["firstAvailableDate", "lastAvailableDate"] as const) {
      if (previous[field] !== undefined && !Object.hasOwn(wireOp.row, field)) wireOp.row[field] = null;
    }
    return wireOp;
  });
}

interface DispatchPreparedBatchInput {
  state: SyncState;
  body: string;
  ops: Op[];
  options?: { keepalive?: boolean; archiveLifecycleDeletes?: boolean };
}

export function dispatchPreparedBatch({
  state,
  body,
  ops,
  options,
}: DispatchPreparedBatchInput): Promise<BatchCommitReceipt> {
  const sequence = state.nextSyncSequence;
  state.nextSyncSequence += 1;
  return postBatch({ state: state, body: body, ops: ops, sequence: sequence, ...(options ? { options } : {}) });
}

// updatedAt on the wire is a concurrency precondition: rebase each PUT onto the last authoritative
// server revision while retaining every locally edited field. A Map per touched table keeps this
// O(ops + rows) — a linear .find per op degraded a whole-table re-timestamp (undo/redo touching
// every allocation) to O(ops × rows) on the hot save path. Maps are built lazily, so a batch that
// touches one table never indexes the rest.
export function rebaseForWire(state: SyncState, ops: Op[]): Op[] {
  const indexByTable = new Map<Op["table"], Map<string, { updatedAt: string }>>();
  const indexFor = (table: Op["table"]): Map<string, { updatedAt: string }> => {
    let index = indexByTable.get(table);
    if (!index) {
      index = new Map(state.lastSynced[table].map((row) => [row.id, row] as const));
      indexByTable.set(table, index);
    }
    return index;
  };
  return ops.map((op) => {
    if (op.method !== "PUT" || !op.row) return op;
    const existing = indexFor(op.table).get(op.id);
    return existing ? { ...op, row: { ...op.row, updatedAt: existing.updatedAt } } : op;
  });
}

interface PostBatchInput {
  state: SyncState;
  body: string;
  ops: Op[];
  sequence: number;
  options?: { keepalive?: boolean; archiveLifecycleDeletes?: boolean };
}

// POST the complete ≤MAX_OPS_PER_BATCH diff to /api/batch; the server applies it in one
// transaction (upserts parent-first, then deletes child-first — see syncOps.diffOps), so a
// mid-batch failure rolls the whole transaction back. keepalive (unload) lets the request outlive
// the page. `body` is the already-serialized, PUT-rebased wire payload; `ops` supplies the exact
// PUT identities that a non-superseded server receipt must cover.
export async function postBatch({ state, body, ops, sequence, options }: PostBatchInput): Promise<BatchCommitReceipt> {
  const res = await sendBatch({ state: state, body: body, sequence: sequence, ...(options ? { options } : {}) });
  await throwForBatchStatus(res);
  return readBatchReceipt(res, ops, options);
}

interface SendBatchInput {
  state: SyncState;
  body: string;
  sequence: number;
  options?: { keepalive?: boolean; archiveLifecycleDeletes?: boolean };
}

/** Dispatch stage: build and send the request, mapping a transport-level failure to the typed
 *  uncertain-commit error (the request may have been applied before the connection died). */
export async function sendBatch({ state, body, sequence, options }: SendBatchInput): Promise<Response> {
  let res: Response;
  try {
    res = await state.request(
      `${state.baseUrl}/api/batch`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CapacityLens-Sync-Session": state.syncSessionId,
          "X-CapacityLens-Sync-Sequence": String(sequence),
        },
        body,
        ...(options?.keepalive === undefined ? {} : { keepalive: options.keepalive }),
        credentials: "include",
      },
      // The atomic write is a BULK op: give it the long bound so a big-but-healthy batch isn't
      // aborted into the retry-the-same-diff wedge (drain never advances lastSynced on abort).
      // The keepalive unload flush gets NO deadline — a timeout on a request meant to outlive the
      // page is self-contradictory; when the page survives, its receipt or failure still flows back
      // through flushUnload to the persistence coordinator.
      options?.keepalive ? null : API_BULK_TIMEOUT_MS,
    );
  } catch (error) {
    if (isTransportFailure(error)) {
      throw new BatchCommitUncertainError("Batch sync ended before its commit receipt was received.", {
        cause: error,
      });
    }
    throw error;
  }
  return res;
}

/** Classification stage: turn a non-OK batch status into the typed error persist.ts branches on.
 *  Returns without effect for a 2xx — the receipt is validated by readBatchReceipt. */
export async function throwForBatchStatus(res: Response): Promise<void> {
  if (!res.ok) {
    // 409 is the optimistic-concurrency conflict signal (stale updatedAt; body
    // `{ error, current }`). Throw the TYPED BatchConflictError so persist.ts can resolve it
    // by reloading (server wins) — retrying the same stale diff is deterministic futility.
    // Body parse is best-effort: an unreadable body still yields a conflict error.
    if (res.status === 409) {
      const body = (await res.json().catch(() => null)) as { current?: unknown } | null;
      throw new BatchConflictError(
        extractApiErrorMessage(body) ?? "Batch sync failed (409): stale write conflict",
        body?.current,
      );
    }
    // A referential or other domain validation failure is equally deterministic. It commonly
    // means another editor archived a parent that this tab's stale slice still showed as active.
    // Give persist.ts a typed signal so it can discard the rejected diff through an authoritative
    // reload instead of re-posting it on every backoff, focus and online event forever.
    if (res.status === 400) {
      const body = (await res.json().catch(() => null)) as { code?: unknown } | null;
      throw new BatchValidationError(
        extractApiErrorMessage(body) ?? "Batch sync failed (400): validation rejected",
        isDomainErrorCode(body?.code) ? body.code : undefined,
      );
    }
    if (res.status === 403) {
      if ((await readMasqueradeErrorCode(res)) === MASQUERADE_ERROR_CODES.readOnly) {
        throw new BatchMasqueradeReadOnlyError("Batch sync was refused while masquerading.");
      }
    }
    // A 401 (session expired on an auth-enabled server) surfaces like any other write
    // failure — persist.ts raises the banner, and the AuthProvider's re-check sees the
    // 401 and swaps to the login screen. Never a silent drop.
    const detail = await res.text().catch(() => "");
    throw createSafeResponseError("Batch sync", res.status, detail);
  }
}

interface BatchReceiptWire {
  ok?: unknown;
  applied?: unknown;
  revisions?: unknown;
  archives?: unknown;
  superseded?: unknown;
  auditWarning?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseBatchReceipt(value: unknown, appliedCount: number): BatchReceiptWire {
  if (!value || typeof value !== "object") {
    throw new BatchCommitUncertainError("Batch sync returned an invalid commit receipt.");
  }
  const receipt: BatchReceiptWire = value;
  if (receipt.ok !== true || (receipt.applied !== undefined && receipt.applied !== appliedCount)) {
    throw new BatchCommitUncertainError("Batch sync returned an invalid commit receipt.");
  }
  if (receipt.applied === undefined) {
    warnCompatibilityOnce(
      "batch-applied",
      "ServerSyncAdapter: the batch receipt omitted 'applied'; accepting the proven commit for rolling-version compatibility.",
    );
  }
  if (receipt.superseded !== undefined && typeof receipt.superseded !== "boolean") {
    throw new BatchCommitUncertainError("Batch sync returned an invalid ordering receipt.");
  }
  return receipt;
}

function isCommittedRevision(value: unknown): value is CommittedRevision {
  if (!isRecord(value)) return false;
  const knownTables = emptyAppData();
  return (
    typeof value.table === "string" &&
    Object.hasOwn(knownTables, value.table) &&
    typeof value.id === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function listReceiptRevisions(receipt: BatchReceiptWire): CommittedRevision[] {
  if (!Array.isArray(receipt.revisions)) {
    warnCompatibilityOnce(
      "batch-revisions",
      "ServerSyncAdapter: the batch receipt omitted server revisions; continuing without revision translation.",
    );
    return [];
  }
  const revisions = receipt.revisions.flatMap((value) => {
    return isCommittedRevision(value) ? [value] : [];
  });
  if (revisions.length !== receipt.revisions.length) {
    warnCompatibilityOnce(
      "batch-invalid-revisions",
      "ServerSyncAdapter: dropping malformed server revisions from an otherwise successful batch receipt.",
    );
  }
  return revisions;
}

function reconcileRevisions(receipt: BatchReceiptWire, ops: Op[]): CommittedRevision[] {
  const expected = new Set(
    receipt.superseded === true
      ? []
      : ops.filter((op) => op.method === "PUT").map((op) => buildRowKey(op.table, op.id)),
  );
  const received = new Set<string>();
  const serverRewrites = new Set<string>();
  const compatibleRevisions: CommittedRevision[] = [];
  for (const revision of listReceiptRevisions(receipt)) {
    const key = buildRowKey(revision.table, revision.id);
    const isExpected = revision.rewrite !== true && expected.has(key) && !received.has(key);
    const isRewrite = revision.rewrite === true && revision.table === "allocations" && !serverRewrites.has(key);
    if (isExpected) received.add(key);
    if (isRewrite) serverRewrites.add(key);
    if (isExpected || isRewrite) compatibleRevisions.push(revision);
    else
      warnCompatibilityOnce(
        "batch-mismatched-revisions",
        "ServerSyncAdapter: dropping unexpected or duplicate server revisions from a successful batch receipt.",
      );
  }
  if (received.size !== expected.size) {
    throw new BatchCommitUncertainError(
      "Batch sync committed without complete server revisions; authoritative reload is required.",
    );
  }
  return compatibleRevisions;
}

function listExpectedArchives(receipt: BatchReceiptWire, ops: Op[], archiveLifecycleDeletes: boolean): Set<string> {
  if (receipt.superseded === true || !archiveLifecycleDeletes) return new Set();
  return new Set(
    ops
      .filter((op) => op.method === "DELETE" && isLifecycleEntityKey(op.table))
      .map((op) => buildRowKey(op.table, op.id)),
  );
}

interface ArchiveReceipt {
  key: string;
  archived: boolean;
}

function parseArchiveReceipt(
  value: unknown,
  expected: ReadonlySet<string>,
  received: ReadonlySet<string>,
): ArchiveReceipt {
  if (!isRecord(value)) {
    throw new BatchCommitUncertainError("Batch sync returned an invalid lifecycle archive receipt.");
  }
  const key = buildRowKey(String(value.table), String(value.id));
  if (
    typeof value.table !== "string" ||
    !isLifecycleEntityKey(value.table) ||
    typeof value.id !== "string" ||
    typeof value.archived !== "boolean" ||
    !expected.has(key) ||
    received.has(key)
  ) {
    throw new BatchCommitUncertainError("Batch sync returned an invalid lifecycle archive receipt.");
  }
  return { key, archived: value.archived };
}

function reconcileArchives(receipt: BatchReceiptWire, expected: ReadonlySet<string>): Set<string> {
  if (expected.size > 0 && !Array.isArray(receipt.archives)) {
    throw new BatchCommitUncertainError("Batch sync committed without lifecycle archive receipts.");
  }
  const rawArchives: unknown[] = Array.isArray(receipt.archives) ? receipt.archives : [];
  const received = new Set<string>();
  const archivedLifecycleKeys = new Set<string>();
  for (const value of rawArchives) {
    const archive = parseArchiveReceipt(value, expected, received);
    received.add(archive.key);
    if (archive.archived) archivedLifecycleKeys.add(archive.key);
  }
  if (received.size !== expected.size) {
    throw new BatchCommitUncertainError("Batch sync committed without complete lifecycle archive receipts.");
  }
  return archivedLifecycleKeys;
}

/** Reconciliation stage: validate the commit receipt, then fold its server revisions and lifecycle
 *  archive confirmations into the {@link BatchCommitReceipt} the caller advances the snapshot with. */
export async function readBatchReceipt(
  res: Response,
  ops: Op[],
  options?: { keepalive?: boolean; archiveLifecycleDeletes?: boolean },
): Promise<BatchCommitReceipt> {
  const receipt = parseBatchReceipt(await res.json().catch(() => null), ops.length);
  // The batch receipt can flag audit degradation in its BODY as well as the shared header; the
  // header half goes through the same synchronous helper as the lifecycle routes above.
  if (receipt.auditWarning === true) announceAuditWarning();
  else noteAuditWarning(res);
  const compatibleRevisions = reconcileRevisions(receipt, ops);
  const expectedArchives = listExpectedArchives(receipt, ops, options?.archiveLifecycleDeletes === true);
  const archivedLifecycleKeys = reconcileArchives(receipt, expectedArchives);
  return {
    revisions: compatibleRevisions,
    archivedLifecycleKeys,
    superseded: receipt.superseded === true,
  };
}
