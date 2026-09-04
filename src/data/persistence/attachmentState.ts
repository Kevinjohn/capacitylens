import type { StoreApi } from "zustand";
import type { AppData } from "@capacitylens/shared/types/entities";
import type { StoreState } from "../../store/useStore";
import { incrementPersistenceDiagnostic, setPersistenceSuspended } from "../persistenceDiagnostics";
import { BatchReconciliationError } from "../ServerSyncAdapter";
import { ReloadDiscardedEditError, type RefreshOutcome } from "./facades";

/** One live owner per attachment. Consumers must read current at the point of use,
 * including after awaits; primitive snapshots are only for explicit sequence comparisons. */
export function createAttachmentState(
  store: StoreApi<StoreState>,
  onError?: (e: unknown) => void,
  onSuccess?: () => void,
) {
  const values = {
    // Detach is an ownership boundary, not merely an event-unsubscribe. Async adapter work cannot
    // always be aborted, so every continuation checks this before it can mutate bookkeeping/store,
    // call the former owner's callbacks, refresh a slice, or schedule another write.
    disposed: false,
    timer: null as ReturnType<typeof setTimeout> | null,
    lastData: store.getState().data,
    pending: null as AppData | null, // data awaiting a debounced write
    // Latest locally changed snapshot not yet confirmed by the adapter. Unlike `pending`, this remains
    // set while a request is in flight and after a failure, so lifecycle events cannot mistake a
    // dispatched-but-unacknowledged edit for clean state.
    unacknowledged: null as AppData | null,
    retryTimer: null as ReturnType<typeof setTimeout> | null,
    retryAttempts: 0,
    failedSinceSuccess: false, // a write failed and hasn't recovered — gates the online/visible re-attempt
    // The exact snapshot rejected as structurally over the atomic batch cap. Focus/online must not
    // replay it; a subsequent user edit clears the marker and gets one fresh attempt.
    terminalBatchSnapshot: null as AppData | null,
    // True while a conflict or uncertain commit is being resolved by an authoritative reload (see
    // save's rejection arm). Guards re-entry: the reload's own entry flush can fail again if other
    // pending edits are stale, and must not recurse into an unbounded reload↔save loop.
    resolvingAuthoritativeReload: false,
    // A reconciliation failure means the last batch either definitely conflicted or may already
    // have committed. Until loadAll installs an authoritative slice, NO path may replay the old
    // diff — including retry, focus/online recovery, import flush, or pagehide keepalive.
    authoritativeReloadRequiredFor: null as string | null,
    // The currently-running save round-trip (P1.13): the account-switch orchestrator AWAITS it so a
    // prior account's save can't land against the new account's snapshot. Resolved (never rejected) so
    // an in-flight FAILED save can still be awaited; settles whether the save succeeds or fails.
    inFlightSave: null as Promise<void> | null,
    // > 0 while writes are SUSPENDED (see suspendServerWrites and refreshActive): edits are parked
    // in `pending` with no timer and retries hold off. A depth, not a boolean, because an external
    // suspension (the server-mode import) and refreshActive's own suspension can overlap — and two
    // refreshActive calls can overlap each other (a switch superseding a focus refresh).
    suspendDepth: 0,
    // The EXTERNAL subset of suspendDepth (the import seam only). Tracked separately because the
    // two kinds differ in what a keepalive unload flush may do: under an INTERNAL (reload)
    // suspension the diff snapshot is still the pre-reload one until loadAll resolves (and the
    // post-resolve stretch to replaceAll is synchronous — no unload event can interleave), so
    // flushing a parked edit on teardown diffs self-vs-self and is SAFE; under an external
    // suspension the import POST may already have replaced the slice server-side, so the same
    // flush would upsert stale pre-import rows.
    externalSuspendDepth: 0,
    externalBaseData: null as AppData | null,
    // A successful reload during an external replacement may temporarily install a rebased parked
    // edit so the normal refresh machinery can preserve it. If the replacement owner then declares
    // that edit stale (`dropParkedEdits`), restore this authoritative server slice as well as clearing
    // the pending-write bookkeeping; otherwise the next unrelated edit would save the stale row again.
    externalAuthoritativeData: null as AppData | null,

    loadingSlice: false,
    switchToken: 0,
    lastActiveAccountId: store.getState().activeAccountId,
    lastRefreshAt: 0,
    focusRefreshInFlight: false,
    switchWaiters: [] as Array<{ id: string | null; resolve: (outcome: RefreshOutcome) => void }>,
  };
  const owner = {
    get current(): Readonly<typeof values> {
      return values;
    },
    update(patch: Partial<typeof values>) {
      Object.assign(values, patch);
    },
    nextSwitchToken() {
      return ++values.switchToken;
    },
    dispose() {
      if (values.disposed) return;
      values.disposed = true;
      for (const waiter of values.switchWaiters.splice(0)) waiter.resolve("unattached");
      setPersistenceSuspended(false);
    },
    cancelDebounce: () => cancelDebounce(),
    cancelRetry: () => cancelRetry(),
    discardEdit: (warning: string, message: string) => discardEdit(warning, message),
    supersededBy: (token: number) => supersededBy(token),
    beginAuthoritativeReloadFor: (
      error: unknown,
      serverMode: boolean,
      startAuthoritativeReload: (id: string) => void,
    ) => beginAuthoritativeReloadFor(error, serverMode, startAuthoritativeReload),
    acknowledge: (data: AppData) => acknowledge(data),
    installSlice: (data: AppData) => installSlice(data),
    beginSuspension(
      external: boolean,
      writes: { save: (data: AppData) => void; scheduleRetry: () => void },
    ): (opts?: { dropParkedEdits?: boolean }) => void {
      const { save, scheduleRetry } = writes;
      // Begin a write suspension. Cancels the armed debounce (parking its edit — `pending` already
      // holds the data) and bumps the depth so the subscribe handler parks instead of scheduling.
      // The returned resume decrements exactly once; when the LAST suspension lifts with an edit
      // still parked, it decides its fate (see suspendServerWrites' doc):
      //  - default: re-schedule it — nothing replaced the slice, so it is an ordinary unsaved edit;
      //  - dropParkedEdits: drop + surface — the slice WAS replaced server-side, so restore a retained
      //    authoritative reload when available and never save the edit made against the old basis.
      // When another suspension still holds the depth, the parked edit is left for THAT holder: a
      // newer refresh either flushes it at its own (a′) or rebases it at its own (c).
      if (owner.current.disposed) return () => {};
      owner.update({ suspendDepth: owner.current.suspendDepth + 1 });
      setPersistenceSuspended(true);
      if (external) {
        if (owner.current.externalSuspendDepth === 0) {
          owner.update({ externalBaseData: store.getState().data });
          owner.update({ externalAuthoritativeData: null });
        }
        owner.update({ externalSuspendDepth: owner.current.externalSuspendDepth + 1 });
      }
      cancelDebounce();
      cancelRetry();
      let resumed = false;
      return (opts = {}) => {
        if (owner.current.disposed) return;
        if (resumed) return; // resume is idempotent — a double call must not underflow the depth
        resumed = true;
        owner.update({ suspendDepth: owner.current.suspendDepth - 1 });
        if (external) {
          owner.update({ externalSuspendDepth: owner.current.externalSuspendDepth - 1 });
        }
        // A nested reload may outlive the external import suspension and still need this base for
        // its operation-level rebase. Once the LAST suspension releases, however, no path may retain
        // the pre-import tree — including the parked-edit drop arm below.
        if (owner.current.suspendDepth > 0) return;
        setPersistenceSuspended(false);
        if (!owner.current.pending) {
          owner.update({ externalBaseData: null });
          owner.update({ externalAuthoritativeData: null });
          if (owner.current.failedSinceSuccess && owner.current.authoritativeReloadRequiredFor === null)
            scheduleRetry();
          return;
        }
        if (opts.dropParkedEdits) {
          owner.update({ pending: null });
          owner.update({ unacknowledged: null });
          owner.update({ externalBaseData: null });
          if (owner.current.externalAuthoritativeData) installSlice(owner.current.externalAuthoritativeData);
          owner.update({ externalAuthoritativeData: null });
          discardEdit(
            "capacitylens: an edit made during a company-data replacement was discarded",
            "An edit arrived while this company’s data was being replaced and could not be saved.",
          );
        } else {
          const parked = owner.current.pending;
          owner.update({ externalBaseData: null });
          owner.update({ externalAuthoritativeData: null });
          save(parked);
        }
      };
    },
  };
  // The debounce/retry cancel idioms, used from many seams — one helper each so a future change
  // to their bookkeeping can't miss a copy (an uncancelled timer firing post-reseed with
  // pre-reload data is exactly the bug class this file exists to prevent).
  const cancelDebounce = () => {
    if (owner.current.timer) {
      clearTimeout(owner.current.timer);
      owner.update({ timer: null });
    }
  };
  const cancelRetry = () => {
    if (owner.current.retryTimer) {
      clearTimeout(owner.current.retryTimer);
      owner.update({ retryTimer: null });
    }
  };
  // Every path that abandons an unsaved edit reports it identically — count it, leave a console
  // breadcrumb, and raise the typed sticky error. Only the wording differs between them.
  const discardEdit = (warning: string, message: string) => {
    incrementPersistenceDiagnostic("editsDiscarded");
    console.warn(warning);
    onError?.(new ReloadDiscardedEditError(message));
  };
  // A reload sequence whose token was superseded — or whose owner detached — must not apply its
  // effects. The supersession is counted only while still attached.
  const supersededBy = (myToken: number): boolean => {
    if (!owner.current.disposed && myToken === owner.current.switchToken) return false;
    if (!owner.current.disposed) incrementPersistenceDiagnostic("reloadsSuperseded");
    return true;
  };
  // The shared arm of BOTH save-rejection handlers (the ordinary save and the teardown keepalive):
  // a deterministic 400/409 rejection or a malformed 2xx commit receipt requires an authoritative
  // reload. Returns true when it has taken ownership of the failure.
  const beginAuthoritativeReloadFor = (
    error: unknown,
    serverMode: boolean,
    startAuthoritativeReload: (id: string) => void,
  ): boolean => {
    if (!serverMode || !(error instanceof BatchReconciliationError)) return false;
    // Never re-arm backoff with a stale or commit-uncertain diff.
    cancelRetry();
    const activeId = store.getState().activeAccountId;
    // A nested reconciliation failure, or no active account to reload, is surfaced without
    // recursion. Keep the write gate raised until a completed reload reseeds the snapshot.
    if (activeId !== null) {
      owner.update({ authoritativeReloadRequiredFor: activeId });
      startAuthoritativeReload(activeId);
    }
    return true;
  };

  const acknowledge = (data: AppData) => {
    if (owner.current.disposed) return;
    const acknowledgesLatest = owner.current.unacknowledged === data || owner.current.unacknowledged === null;
    if (owner.current.unacknowledged === data) owner.update({ unacknowledged: null });
    if (owner.current.pending === data) owner.update({ pending: null });
    // A response for an older snapshot cannot clear the failure/retry state of a newer write.
    if (!acknowledgesLatest) return;
    owner.update({ retryAttempts: 0 });
    owner.update({ failedSinceSuccess: false });
    owner.update({ terminalBatchSnapshot: null });
    cancelRetry();
    onSuccess?.();
  };

  // Install a slice as a tenant LOAD, never a user edit: swap the store under `loadingSlice` and
  // advance lastData in lockstep, exactly as every install site did by hand.
  const installSlice = (data: AppData) => {
    owner.update({ loadingSlice: true });
    store.getState().replaceAll(data);
    owner.update({ lastData: store.getState().data });
    owner.update({ loadingSlice: false });
  };

  return owner;
}
export type AttachmentState = ReturnType<typeof createAttachmentState>;
