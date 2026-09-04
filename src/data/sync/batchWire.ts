import { isDomainErrorCode } from "@capacitylens/shared/domain/errors";
import { isLifecycleEntityKey } from "@capacitylens/shared/domain/lifecycle";
import { MASQUERADE_ERROR_CODES } from "@capacitylens/shared/domain/masquerade";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import { announceAuditWarning, noteAuditWarning } from "../../lib/auditWarning";
import { apiErrorFromBody } from "../../lib/readApiError";
import { API_BULK_TIMEOUT_MS, isTransportFailure, masqueradeErrorCode } from "../requestTimeout";
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
  rowKey,
  safeResponseError,
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
  opts?: { keepalive?: boolean; archiveLifecycleDeletes?: boolean },
): Promise<BatchCommitReceipt> {
  return dispatchPreparedBatch(state, prepareBatchBody(state, ops, opts), ops, opts);
}

/** Validate and serialize before a teardown dispatches any ordering-dependent sibling request. */
export function prepareBatchBody(
  state: SyncState,
  ops: Op[],
  opts?: { keepalive?: boolean; archiveLifecycleDeletes?: boolean },
): string {
  if (ops.length > MAX_OPS_PER_BATCH) {
    throw new BatchTooLargeError(`Atomic sync exceeds the ${MAX_OPS_PER_BATCH}-operation server limit.`);
  }
  // Rebase PUT preconditions, then serialize ONCE — the same body feeds both the keepalive
  // byte-budget check and the request, so a large batch isn't JSON.stringified twice per save.
  const wireOps = rebaseForWire(state, ops).map((op) =>
    opts?.archiveLifecycleDeletes && op.method === "DELETE" && isLifecycleEntityKey(op.table)
      ? { ...op, method: "ARCHIVE" }
      : op,
  );
  const body = JSON.stringify({ ops: wireOps });
  if (opts?.keepalive && new TextEncoder().encode(body).byteLength > KEEPALIVE_BODY_BUDGET) {
    throw new KeepaliveNotDispatchedError("The pending change was too large for a page-teardown keepalive request.");
  }
  return body;
}

export function dispatchPreparedBatch(
  state: SyncState,
  body: string,
  ops: Op[],
  opts?: { keepalive?: boolean; archiveLifecycleDeletes?: boolean },
): Promise<BatchCommitReceipt> {
  const sequence = state.nextSyncSequence;
  state.nextSyncSequence += 1;
  return postBatch(state, body, ops, sequence, opts);
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

// POST the complete ≤MAX_OPS_PER_BATCH diff to /api/batch; the server applies it in one
// transaction (upserts parent-first, then deletes child-first — see syncOps.diffOps), so a
// mid-batch failure rolls the whole transaction back. keepalive (unload) lets the request outlive
// the page. `body` is the already-serialized, PUT-rebased wire payload; `ops` supplies the exact
// PUT identities that a non-superseded server receipt must cover.
export async function postBatch(
  state: SyncState,
  body: string,
  ops: Op[],
  sequence: number,
  opts?: { keepalive?: boolean; archiveLifecycleDeletes?: boolean },
): Promise<BatchCommitReceipt> {
  const res = await sendBatch(state, body, sequence, opts);
  await throwForBatchStatus(res);
  return readBatchReceipt(res, ops, opts);
}

/** Dispatch stage: build and send the request, mapping a transport-level failure to the typed
 *  uncertain-commit error (the request may have been applied before the connection died). */
export async function sendBatch(
  state: SyncState,
  body: string,
  sequence: number,
  opts?: { keepalive?: boolean; archiveLifecycleDeletes?: boolean },
): Promise<Response> {
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
        keepalive: opts?.keepalive,
        credentials: "include",
      },
      // The atomic write is a BULK op: give it the long bound so a big-but-healthy batch isn't
      // aborted into the retry-the-same-diff wedge (drain never advances lastSynced on abort).
      // The keepalive unload flush gets NO deadline — a timeout on a request meant to outlive the
      // page is self-contradictory; when the page survives, its receipt or failure still flows back
      // through flushUnload to the persistence coordinator.
      opts?.keepalive ? null : API_BULK_TIMEOUT_MS,
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
        apiErrorFromBody(body) ?? "Batch sync failed (409): stale write conflict",
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
        apiErrorFromBody(body) ?? "Batch sync failed (400): validation rejected",
        isDomainErrorCode(body?.code) ? body.code : undefined,
      );
    }
    if (res.status === 403) {
      if ((await masqueradeErrorCode(res)) === MASQUERADE_ERROR_CODES.readOnly) {
        throw new BatchMasqueradeReadOnlyError("Batch sync was refused while masquerading.");
      }
    }
    // A 401 (session expired on an auth-enabled server) surfaces like any other write
    // failure — persist.ts raises the banner, and the AuthProvider's re-check sees the
    // 401 and swaps to the login screen. Never a silent drop.
    const detail = await res.text().catch(() => "");
    throw safeResponseError("Batch sync", res.status, detail);
  }
}

/** Reconciliation stage: validate the commit receipt, then fold its server revisions and lifecycle
 *  archive confirmations into the {@link BatchCommitReceipt} the caller advances the snapshot with. */
export async function readBatchReceipt(
  res: Response,
  ops: Op[],
  opts?: { keepalive?: boolean; archiveLifecycleDeletes?: boolean },
): Promise<BatchCommitReceipt> {
  const receipt = (await res.json().catch(() => null)) as {
    ok?: unknown;
    applied?: unknown;
    revisions?: unknown;
    archives?: unknown;
    superseded?: unknown;
    auditWarning?: unknown;
  } | null;
  if (receipt?.ok !== true || (receipt.applied !== undefined && receipt.applied !== ops.length)) {
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
  // The batch receipt can flag audit degradation in its BODY as well as the shared header; the
  // header half goes through the same synchronous helper as the lifecycle routes above.
  if (receipt.auditWarning === true) announceAuditWarning();
  else noteAuditWarning(res);
  const rawRevisions = Array.isArray(receipt.revisions) ? receipt.revisions : [];
  if (!Array.isArray(receipt.revisions))
    warnCompatibilityOnce(
      "batch-revisions",
      "ServerSyncAdapter: the batch receipt omitted server revisions; continuing without revision translation.",
    );
  const knownTables = emptyAppData(); // hoisted: one shape probe for the whole receipt, not one per revision
  const revisions = rawRevisions.filter((revision): revision is CommittedRevision => {
    if (!revision || typeof revision !== "object") return false;
    const value = revision as Partial<CommittedRevision>;
    return (
      typeof value.table === "string" &&
      Object.hasOwn(knownTables, value.table) &&
      typeof value.id === "string" &&
      typeof value.createdAt === "string" &&
      typeof value.updatedAt === "string"
    );
  });
  if (revisions.length !== rawRevisions.length)
    warnCompatibilityOnce(
      "batch-invalid-revisions",
      "ServerSyncAdapter: dropping malformed server revisions from an otherwise successful batch receipt.",
    );

  const expected = new Set(
    receipt.superseded === true ? [] : ops.filter((op) => op.method === "PUT").map((op) => rowKey(op.table, op.id)),
  );
  const received = new Set<string>();
  const serverRewrites = new Set<string>();
  const compatibleRevisions: CommittedRevision[] = [];
  for (const revision of revisions) {
    const key = rowKey(revision.table, revision.id);
    if (revision.rewrite !== true && expected.has(key) && !received.has(key)) {
      received.add(key);
      compatibleRevisions.push(revision);
      continue;
    }
    if (revision.rewrite === true && revision.table === "allocations" && !serverRewrites.has(key)) {
      serverRewrites.add(key);
      compatibleRevisions.push(revision);
      continue;
    }
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
  const expectedArchives = new Set(
    receipt.superseded === true || !opts?.archiveLifecycleDeletes
      ? []
      : ops
          .filter((op) => op.method === "DELETE" && isLifecycleEntityKey(op.table))
          .map((op) => rowKey(op.table, op.id)),
  );
  const rawArchives = Array.isArray(receipt.archives) ? receipt.archives : [];
  if (expectedArchives.size > 0 && !Array.isArray(receipt.archives)) {
    throw new BatchCommitUncertainError("Batch sync committed without lifecycle archive receipts.");
  }
  const receivedArchives = new Set<string>();
  const archivedLifecycleKeys = new Set<string>();
  for (const archiveReceipt of rawArchives) {
    if (!archiveReceipt || typeof archiveReceipt !== "object") {
      throw new BatchCommitUncertainError("Batch sync returned an invalid lifecycle archive receipt.");
    }
    const value = archiveReceipt as { table?: unknown; id?: unknown; archived?: unknown };
    const key = rowKey(String(value.table), String(value.id));
    if (
      typeof value.table !== "string" ||
      !isLifecycleEntityKey(value.table) ||
      typeof value.id !== "string" ||
      typeof value.archived !== "boolean" ||
      !expectedArchives.has(key) ||
      receivedArchives.has(key)
    ) {
      throw new BatchCommitUncertainError("Batch sync returned an invalid lifecycle archive receipt.");
    }
    receivedArchives.add(key);
    if (value.archived) archivedLifecycleKeys.add(key);
  }
  if (receivedArchives.size !== expectedArchives.size) {
    throw new BatchCommitUncertainError("Batch sync committed without complete lifecycle archive receipts.");
  }
  return {
    revisions: compatibleRevisions,
    archivedLifecycleKeys,
    superseded: receipt.superseded === true,
  };
}
