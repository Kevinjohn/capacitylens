import type { StoreApi } from "zustand";
import type { StoreState } from "../../store/useStore";
import type { PersistenceAdapter } from "../PersistenceAdapter";
import { withoutAllocationAttribution } from "@capacitylens/shared/lib/integrity";
import { resetPersistenceDiagnostics } from "../persistenceDiagnostics";
import { persistenceCoordinator } from "./coordinator";
import { createAttachmentState } from "./attachmentState";
import { createWriteQueue } from "./writeQueue";
import { createRefreshController } from "./refreshController";
import { attachAccountSwitch } from "./accountSwitch";
import { attachDomListeners } from "./domListeners";

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
export function attachPersistence(
  store: StoreApi<StoreState>,
  adapter: PersistenceAdapter,
  debounceMs = 300,
  onError?: (e: unknown) => void,
  onSuccess?: () => void,
  serverMode = false,
): () => void {
  const owner = createAttachmentState(store, onError, onSuccess);
  const writes = createWriteQueue(
    store,
    adapter,
    owner,
    serverMode,
    (id) => refresh.startAuthoritativeReload(id),
    onError,
  );
  const refresh = createRefreshController(store, adapter, owner, writes, onError, onSuccess);
  const { save } = writes;
  const { cancelDebounce, cancelRetry } = owner;
  const { refreshActive, beginSuspension } = refresh;
  const unsubscribe = store.subscribe((state) => {
    if (owner.current.disposed) return;
    if (state.data === owner.current.lastData) return; // only persist when data actually changes
    owner.update({ lastData: state.data });
    // The orchestrator's slice load is not a user edit — track lastData (done) but DON'T save it.
    if (owner.current.loadingSlice) return;
    owner.update({ unacknowledged: state.data });
    owner.update({ terminalBatchSnapshot: null });
    // Suspended (a slice replacement is in flight): PARK the edit — record it in `pending` with no
    // timer so nothing sends it. It is rebased by a successful reload, or re-scheduled on resume
    // when the suspending operation failed before any reload.
    if (owner.current.suspendDepth > 0) {
      owner.update({ pending: state.data });
      return;
    }
    owner.update({ retryAttempts: 0 }); // a fresh user change earns a fresh retry budget
    if (debounceMs <= 0) {
      save(state.data);
      return;
    }
    owner.update({ pending: state.data });
    if (owner.current.timer) clearTimeout(owner.current.timer);
    owner.update({ timer: setTimeout(() => save(state.data), debounceMs) });
  });

  const { unsubscribeSwitch, myRegisteredSwitch } = attachAccountSwitch(store, owner, writes, refresh, serverMode);
  // Register the orchestrator-backed refresh for out-of-band server writers (see
  // refreshActiveAccountSlice above). Server mode only — the demo build's lifecycle actions mutate
  // the store directly and never reload. abortIfSaveFailed for the same reason as focus-refresh:
  // a post-lifecycle reload is a convenience re-hydrate, never worth destroying un-persisted edits.
  const myRegisteredRefresh = serverMode ? (id: string) => refreshActive(id, { abortIfSaveFailed: true }) : null;

  // Flush-pending seam for out-of-band whole-slice writers (the server-mode import): land any
  // still-debounced edit against the CURRENT state, in order, and report whether writes are clean.
  // Returning false (a write is still failed) tells the caller its precondition — "local edits are
  // persisted or knowingly abandoned" — does not hold; the import path refuses to proceed rather
  // than let its post-import reload wipe an unsaved edit or its retry replay a stale diff over the
  // freshly imported slice.
  const myRegisteredFlush = serverMode
    ? async (): Promise<boolean> => {
        if (owner.current.disposed) return false;
        if (owner.current.authoritativeReloadRequiredFor !== null) return false;
        // Suspended: another slice replacement is already in flight — writes are NOT clean and
        // flushing the parked edit would push it against a mid-replacement snapshot. Refuse.
        if (owner.current.suspendDepth > 0) return false;
        // Loop until QUIESCENT, not just one round: writes are unsuspended during the await, so
        // an edit landing mid-flush arms a fresh debounce whose save can outlive a single await —
        // a one-shot flush would then return "clean" while that save is still on the wire, and
        // the caller's import POST would race it (the exact pre-suspension window the whole
        // import sequence exists to close). Terminates when a full round finds nothing new.
        const deadline = Date.now() + 120_000;
        let rounds = 0;
        while (
          !owner.current.disposed &&
          (owner.current.timer || owner.current.pending || owner.current.inFlightSave) &&
          rounds < 100 &&
          Date.now() < deadline
        ) {
          rounds += 1;
          cancelDebounce();
          if (owner.current.pending) save(owner.current.pending); // consumes pending, sets inFlightSave synchronously
          if (owner.current.inFlightSave) await owner.current.inFlightSave;
          if (owner.current.suspendDepth > 0) return false;
        }
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
    : null;
  // Write-suspension seam (see suspendServerWrites' doc for the resume contract) — the EXTERNAL
  // variant of beginSuspension, registered for the server-mode import.
  const myRegisteredSuspend = serverMode ? () => beginSuspension(true) : null;
  const myRegisteredHasUnsaved = () =>
    !owner.current.disposed &&
    (owner.current.unacknowledged !== null ||
      owner.current.pending !== null ||
      owner.current.inFlightSave !== null ||
      owner.current.failedSinceSuccess ||
      owner.current.authoritativeReloadRequiredFor !== null);
  const unregisterCoordinator = persistenceCoordinator.attach({
    ...(myRegisteredRefresh ? { refreshActive: myRegisteredRefresh } : {}),
    ...(myRegisteredFlush ? { flushPending: myRegisteredFlush } : {}),
    ...(myRegisteredSuspend ? { suspendWrites: myRegisteredSuspend } : {}),
    ...(myRegisteredSwitch ? { switchAndAwaitHydration: myRegisteredSwitch } : {}),
    hasUnsavedWrites: myRegisteredHasUnsaved,
  });
  resetPersistenceDiagnostics();
  adapter.setAllocationRewriteHandler?.((revisions) => {
    const byId = new Map(revisions.map((revision) => [revision.id, revision]));
    store.setState((state) => {
      let changed = false;
      const allocations = state.data.allocations.map((allocation) => {
        const revision = byId.get(allocation.id);
        if (!revision || allocation.updatedAt !== revision.flushedUpdatedAt) return allocation;
        changed = true;
        return withoutAllocationAttribution(allocation, revision.updatedAt);
      });
      return changed ? { ...state, data: { ...state.data, allocations } } : state;
    });
  });

  const detachDomListeners = attachDomListeners(store, owner, writes, refresh, serverMode);
  return () => {
    if (owner.current.disposed) return;
    owner.dispose();
    unsubscribe();
    unsubscribeSwitch?.();
    unregisterCoordinator();
    adapter.setAllocationRewriteHandler?.(null);
    detachDomListeners();
    cancelDebounce();
    cancelRetry();
  };
}
