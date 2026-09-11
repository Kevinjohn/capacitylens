import type { FlushPendingWritesResult } from "./facades";
import type { StoreApi } from "zustand";
import type { StoreState } from "../../store/useStore";
import type { PersistenceAdapter } from "../PersistenceAdapter";
import { withoutAllocationAttribution } from "@capacitylens/shared/lib/integrity";
import { resetPersistenceDiagnostics } from "../persistenceDiagnostics";
import { persistenceCoordinator } from "./coordinator";
import { createAttachmentState, type AttachmentState } from "./attachmentState";
import { createWriteQueue, type WriteQueue } from "./writeQueue";
import { createRefreshController, type RefreshController } from "./refreshController";
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
    // The orchestrator's slice load is not a user edit — track lastData (done) but DON'T save it.
    if (owner.current.loadingSlice) return;
    owner.update({ unacknowledged: state.data, terminalBatchSnapshot: null, lastError: null });
    // Suspended (a slice replacement is in flight): PARK the edit — record it in `pending` with no
    // timer so nothing sends it. It is rebased by a successful reload, or re-scheduled on resume
    // when the suspending operation failed before any reload.
    if (owner.current.suspendDepth > 0) {
      owner.update({ pending: state.data });
      return;
    }
    owner.update({ retryAttempts: 0 }); // a fresh user change earns a fresh retry budget
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
    // Loop until QUIESCENT, not just one round: writes are unsuspended during the await, so an edit
    // landing mid-flush arms a fresh debounce whose save can outlive a single await. A one-shot
    // flush would then return "clean" while that save is still on the wire, and the caller's import
    // POST would race it (the exact pre-suspension window this sequence closes). The caps prevent
    // a continuously edited store from holding the seam open.
    const deadline = Date.now() + 120_000;
    let rounds = 0;
    while (hasQueuedWrite(owner) && rounds < 100 && Date.now() < deadline) {
      rounds += 1;
      owner.cancelDebounce();
      const pending = owner.current.pending;
      if (pending) writes.save(pending); // consumes pending, sets inFlightSave synchronously
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
  // Register the orchestrator-backed refresh for out-of-band server writers. Server mode only —
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
    hasUnsavedWrites: () => hasUnsavedWrites(owner),
  });
}

function attachAllocationRewriteHandler({ store, adapter }: Pick<PersistenceParts, "store" | "adapter">): void {
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
}

/**
 * Wire the store to a PersistenceAdapter (OUTSIDE the store) and return a hard-detach function.
 * Detach cancels ownership without initiating a final write; a caller that needs a confirmed handoff
 * must call {@link flushPendingWrites} before detaching.
 *
 * Lifecycle of a write — the moving parts, top-down (each is detailed inline below):
 *  1. A data change fires the store subscription → schedule a DEBOUNCED save (immediate when
 *     `debounceMs <= 0`). A fresh edit resets the retry budget.
 *  2. `save()` runs `adapter.saveAll`; on success it clears the error state (`onSuccess`) and the
 *     retry budget, on failure it calls `onError` and `scheduleRetry()`.
 *  3. `scheduleRetry()` re-sends the LATEST store state with capped exponential backoff
 *     (max 5 attempts), so a transient failure self-heals without waiting for the next edit.
 *  4. A STRANDED write (failed AND budget exhausted) is re-attempted when the connection plausibly
 *     recovers — the `online` event, or the tab becoming visible again (gated on a real failure).
 *  5. `visibilitychange→hidden` flushes through the normal serialized path while the page survives;
 *     `pagehide` uses the adapter's keepalive teardown path.
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
  const unregisterCoordinator = attachCoordinator(parts, accountSwitch);
  resetPersistenceDiagnostics();
  attachAllocationRewriteHandler(parts);
  const detachDomListeners = attachDomListeners(parts);
  return () => {
    if (owner.current.disposed) return;
    owner.dispose();
    unsubscribe();
    accountSwitch.unsubscribeSwitch?.();
    unregisterCoordinator();
    adapter.setAllocationRewriteHandler?.(null);
    detachDomListeners();
    owner.cancelDebounce();
    owner.cancelRetry();
  };
}
