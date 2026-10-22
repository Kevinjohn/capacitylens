import { isDomainErrorCode } from "@capacitylens/shared/domain/errors";
import { isLifecycleEntityKey } from "@capacitylens/shared/domain/lifecycle";
import { MASQUERADE_ERROR_CODES } from "@capacitylens/shared/domain/masquerade";
import { extractApiErrorMessage } from "@/lib/readApiError";
import { API_BULK_TIMEOUT_MS, isTransportFailure, readMasqueradeErrorCode } from "@/data/requestTimeout";
import type { Op } from "@/data/syncOps";
import {
  BatchCommitUncertainError,
  BatchConflictError,
  BatchMasqueradeReadOnlyError,
  BatchTooLargeError,
  BatchValidationError,
  KEEPALIVE_BODY_BUDGET,
  KeepaliveNotDispatchedError,
  MAX_BATCH_OPS,
} from "./batchErrors";
import { createSafeResponseError } from "./revisions";
import type { BatchCommitReceipt } from "./revisions";
import { readBatchReceipt } from "./batchReceipt";
import type { SyncState } from "./SyncState";
import { addResourceAvailabilityClearMarkers } from "./resourceAvailabilityWire";

// Apply the complete ordered diff as one request and therefore one SQLite transaction. An
// over-limit diff is never split into separately committed prefixes.
/** Validates and dispatches one ordered atomic batch.
 * @throws BatchTooLargeError before dispatch when the operation limit is exceeded.
 * @throws KeepaliveNotDispatchedError before dispatch when a teardown body is too large.
 */
export function commitBatch(
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
  if (ops.length > MAX_BATCH_OPS) {
    throw new BatchTooLargeError(`Atomic sync exceeds the ${MAX_BATCH_OPS}-operation server limit.`);
  }
  // Rebase PUT preconditions, then serialize once, the same body feeds both the keepalive
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

interface DispatchPreparedBatchInput {
  state: SyncState;
  body: string;
  ops: Op[];
  options?: { keepalive?: boolean; archiveLifecycleDeletes?: boolean };
}

/** Assigns the next session sequence and dispatches a previously validated, serialized batch. */
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

// Rebase concurrency stamps without replacing local fields. Lazy per-table maps keep
// lookup linear in touched rows and operations, including whole-table undo and redo.
/** Returns operations with PUT concurrency stamps taken from the authoritative baseline while preserving local fields.
 * Does not mutate operations or the baseline.
 */
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

// Ordinary operations commit in one transaction, with upserts before deletes so
// reparented children survive deletion cascades. The receipt must cover the sent PUT identities.
/** Sends a validated, serialized ordered batch and checks its authoritative receipt.
 * Transport uncertainty or invalid receipts require a reload before another write.
 */
export async function postBatch({ state, body, ops, sequence, options }: PostBatchInput): Promise<BatchCommitReceipt> {
  const res = await sendBatch({ state: state, body: body, sequence: sequence, ...(options ? { options } : {}) });
  await throwForBatchStatus(res);
  return readBatchReceipt({
    response: res,
    ops,
    archiveLifecycleDeletes: options?.archiveLifecycleDeletes === true,
  });
}

interface SendBatchInput {
  state: SyncState;
  body: string;
  sequence: number;
  options?: { keepalive?: boolean; archiveLifecycleDeletes?: boolean };
}

/** Dispatch stage: build and send the request, mapping a transport-level failure to the typed
 * uncertain-commit error (the request may have been applied before the connection died). */
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
      // Bulk writes need a longer deadline on a healthy but slow server. Teardown disables
      // the client deadline; any surviving page still receives its receipt or failure.
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
 * Returns without effect for a 2xx. The receipt is validated by readBatchReceipt. */
export async function throwForBatchStatus(res: Response): Promise<void> {
  if (!res.ok) {
    // 409 is the optimistic-concurrency conflict signal (stale updatedAt; body
    // `{ error, current }`). Throw the typed BatchConflictError so persist.ts can resolve it
    // by reloading (server wins), retrying the same stale diff is deterministic futility.
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
    // failure: persist.ts raises the banner, and the AuthProvider's re-check sees the
    // 401 and swaps to the login screen. Never a silent drop.
    const detail = await res.text().catch(() => "");
    throw createSafeResponseError("Batch sync", res.status, detail);
  }
}

export { readBatchReceipt } from "./batchReceipt";
