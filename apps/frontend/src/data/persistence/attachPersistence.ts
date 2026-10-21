import type { FlushPendingWritesResult } from "./facades";
import type { StoreApi } from "zustand";
import type { StoreState } from "@/store/useStore";
import type { PersistenceAdapter } from "@/data/PersistenceAdapter";
import { withoutAllocationAttribution } from "@capacitylens/shared/lib/integrity";
import { resetPersistenceDiagnostics } from "@/data/persistenceDiagnostics";
import { persistenceCoordinator } from "./coordinator";
import { createAttachmentState } from "./attachmentState";
import type { AttachmentState } from "./attachmentState";
import { createWriteQueue } from "./writeQueue";
import type { WriteQueue } from "./writeQueue";
import { createRefreshController } from "./refreshController";
import type { RefreshController } from "./refreshController";
import { attachAccountSwitch } from "./accountSwitch";
import { attachDomListeners } from "./domListeners";

interface AttachPersistenceInput {
  store: StoreApi<StoreState>;
  adapter: PersistenceAdapter;
  debounceMs?: number;
  onError?: (error: unknown) => void;
  onSuccess?: () => void;
  serverMode?: boolean;
}

interface PersistenceParts {
  store: StoreApi<StoreState>;
  adapter: PersistenceAdapter;
  owner: AttachmentState;
  writes: WriteQueue;
  refresh: RefreshController;
  serverMode: boolean;
}

function attachStoreSubscription(
  input: Pick<PersistenceParts, "store" | "owner" | "writes"> & { debounceMs: number },
): () => void {
  const { store, owner, writes, debounceMs } = input;
  return store.subscribe((state) => {
    if (owner.current.disposed || state.data === owner.current.lastData) return;
    owner.update({ lastData: state.data });
    // Hydration must not echo a server slice back as a user write.
    if (owner.current.loadingSlice) return;
    owner.update({ unacknowledged: state.data, lastError: null });
    // Suspended (a slice replacement is in flight): park the edit, record it in `pending` with no
    // timer so nothing sends it. It is rebased by a successful reload, or re-scheduled on resume
    // when the suspending operation failed before any reload.
    if (owner.current.suspendDepth > 0) {
      owner.update({ pending: state.data });
      return;
    }
    // A fresh user edit earns a new retry budget.
    owner.update({ retryAttempts: 0 });
    if (debounceMs <= 0) {
      writes.save(state.data);
      return;
    }
    owner.update({ pending: state.data });
    if (owner.current.timer) clearTimeout(owner.current.timer);
    owner.update({ timer: setTimeout(() => writes.save(state.data), debounceMs) });
  });
}

function isFlushBlocked(owner: AttachmentState): boolean {
  // A reconciliation in progress leaves the batch commit boundary uncertain, so import must not
  // replay the possibly committed diff. A suspension means another replacement is already in
  // flight; flushing its parked edit would push it against a mid-replacement snapshot.
  return (
    owner.current.disposed || owner.current.authoritativeReloadRequiredFor !== null || owner.current.suspendDepth > 0
  );
}

function hasQueuedWrite(owner: AttachmentState): boolean {
  return (
    !owner.current.disposed &&
    (owner.current.timer !== null || owner.current.pending !== null || owner.current.inFlightSave !== null)
  );
}

function isWriteStateClean(owner: AttachmentState): boolean {
  return (
    !owner.current.disposed &&
    owner.current.suspendDepth === 0 &&
    !owner.current.timer &&
    !owner.current.pending &&
    !owner.current.inFlightSave &&
    !owner.current.failedSinceSuccess &&
    owner.current.unacknowledged === null
  );
}

function createFlushPending(owner: AttachmentState, writes: WriteQueue): () => Promise<FlushPendingWritesResult> {
  return async () => {
    if (isFlushBlocked(owner)) return { kind: "blocked" };
    // Await quiescence because an edit during a flush can start another save. Bound the loop
    // so continuous editing cannot hold the import seam open indefinitely.
    const deadline = Date.now() + 120_000;
    let rounds = 0;
    while (hasQueuedWrite(owner) && rounds < 100 && Date.now() < deadline) {
      rounds += 1;
      owner.cancelDebounce();
      const pending = owner.current.pending;
      if (pending) writes.save(pending);
      const inFlightSave = owner.current.inFlightSave;
      if (inFlightSave) await inFlightSave;
      if (owner.current.lastError !== null) return { kind: "failed", error: owner.current.lastError };
      if (owner.current.suspendDepth > 0) return { kind: "blocked" };
    }
    return isWriteStateClean(owner) ? { kind: "clean" } : { kind: "blocked" };
  };
}

function hasUnsavedWrites(owner: AttachmentState): boolean {
  return (
    !owner.current.disposed &&
    (owner.current.unacknowledged !== null ||
      owner.current.pending !== null ||
      owner.current.inFlightSave !== null ||
      owner.current.failedSinceSuccess ||
      owner.current.authoritativeReloadRequiredFor !== null)
  );
}

function attachCoordinator(parts: PersistenceParts, accountSwitch: ReturnType<typeof attachAccountSwitch>): () => void {
  const { owner, refresh, serverMode } = parts;
  // Register the orchestrator-backed refresh for out-of-band server writers. Server mode only,
  // the demo build's lifecycle actions mutate the store directly and never reload. Save failure
  // aborts because a convenience re-hydrate must never destroy un-persisted edits.
  const registeredRefresh = serverMode ? (id: string) => refresh.refreshActive(id, { abortIfSaveFailed: true }) : null;
  // The import seam lands every debounced edit against the current snapshot before replacement.
  // A blocked result prevents import from wiping an unsaved edit or replaying it over fresh data.
  const registeredFlush = serverMode ? createFlushPending(owner, parts.writes) : null;
  // External suspension parks writes across the import POST and its authoritative re-hydrate.
  const registeredSuspend = serverMode ? () => refresh.beginSuspension({ external: true }) : null;
  return persistenceCoordinator.attach({
    ...(registeredRefresh ? { refreshActive: registeredRefresh } : {}),
    ...(registeredFlush ? { flushPending: registeredFlush } : {}),
    ...(registeredSuspend ? { suspendWrites: registeredSuspend } : {}),
    ...(accountSwitch.myRegisteredSwitch ? { switchAndAwaitHydration: accountSwitch.myRegisteredSwitch } : {}),
    ...(accountSwitch.myRegisteredRetry ? { retryActiveAccountLoad: accountSwitch.myRegisteredRetry } : {}),
    hasUnsavedWrites: () => hasUnsavedWrites(owner),
  });
}

function attachCommittedRevisionHandler({
  store,
  adapter,
  owner,
}: Pick<PersistenceParts, "store" | "adapter" | "owner">): void {
  adapter.setCommittedRevisionHandler?.((revisions) => {
    if (owner.current.disposed) return;
    // A receipt changes metadata, not user intent. Suppress the persistence echo while keeping
    // pending snapshot identities intact so the original write can still be acknowledged.
    const loadingSlice = owner.current.loadingSlice;
    owner.update({ loadingSlice: true });
    try {
      store.setState((state) => {
        let data = state.data;
        for (const revision of revisions) {
          const rows = data[revision.table];
          const next = rows.map((row) =>
            row.id === revision.id && row.updatedAt === revision.flushedUpdatedAt
              ? { ...row, createdAt: revision.createdAt, updatedAt: revision.updatedAt }
              : row,
          );
          if (next.some((row, index) => row !== rows[index])) data = { ...data, [revision.table]: next };
        }
        return data === state.data ? state : { data };
      });
    } finally {
      owner.update({ loadingSlice });
    }
  });
}

function attachReceiptHandlers(parts: Pick<PersistenceParts, "store" | "adapter" | "owner">): () => void {
  const { store, adapter } = parts;
  attachCommittedRevisionHandler(parts);
  adapter.setAllocationRewriteHandler?.((revisions) => {
    const revisionsById = new Map(revisions.map((revision) => [revision.id, revision]));
    store.setState((state) => {
      const allocations = state.data.allocations.map((allocation) => {
        const revision = revisionsById.get(allocation.id);
        return revision && allocation.updatedAt === revision.flushedUpdatedAt
          ? withoutAllocationAttribution(allocation, revision.updatedAt)
          : allocation;
      });
      const changed = allocations.some((allocation, index) => allocation !== state.data.allocations[index]);
      return changed ? { ...state, data: { ...state.data, allocations } } : state;
    });
  });
  return () => {
    adapter.setCommittedRevisionHandler?.(null);
    adapter.setAllocationRewriteHandler?.(null);
  };
}

/** Attaches one persistence owner and returns a hard-detach function. Detach cancels
 * ownership without a final write; flushPendingWrites must confirm any required handoff.
 * Saves debounce and retry transient failures with a bounded backoff. Page teardown
 * uses keepalive while ordinary visibility changes use the serialized save path.
 */
export function attachPersistence({
  store,
  adapter,
  debounceMs = 300,
  onError,
  onSuccess,
  serverMode = false,
}: AttachPersistenceInput): () => void {
  const owner = createAttachmentState(store, onError, onSuccess);
  const writes = createWriteQueue({
    store: store,
    adapter: adapter,
    owner: owner,
    serverMode: serverMode,
    startAuthoritativeReload: (id) => refresh.startAuthoritativeReload(id),
    ...(onError ? { onError } : {}),
  });
  const refresh = createRefreshController({
    store: store,
    adapter: adapter,
    owner: owner,
    writes: writes,
    ...(onError ? { onError } : {}),
    ...(onSuccess ? { onSuccess } : {}),
  });
  const parts = { store, adapter, owner, writes, refresh, serverMode };
  const unsubscribe = attachStoreSubscription({ store, owner, writes, debounceMs });
  const accountSwitch = attachAccountSwitch({
    store: store,
    owner: owner,
    writes: writes,
    refresh: refresh,
    serverMode: serverMode,
  });
  let unregisterCoordinator: () => void;
  try {
    unregisterCoordinator = attachCoordinator(parts, accountSwitch);
  } catch (error) {
    // A rejected duplicate owner must leave nothing behind that could still save through it.
    owner.dispose();
    unsubscribe();
    accountSwitch.unsubscribeSwitch?.();
    owner.cancelDebounce();
    owner.cancelRetry();
    throw error;
  }
  resetPersistenceDiagnostics();
  const detachReceiptHandlers = attachReceiptHandlers(parts);
  const detachDomListeners = attachDomListeners(parts);
  return () => {
    if (owner.current.disposed) return;
    owner.dispose();
    unsubscribe();
    accountSwitch.unsubscribeSwitch?.();
    unregisterCoordinator();
    detachReceiptHandlers();
    detachDomListeners();
    owner.cancelDebounce();
    owner.cancelRetry();
  };
}
