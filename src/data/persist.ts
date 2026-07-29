import type { StoreApi } from "zustand";
import { emptyAppData, isEmpty } from "@capacitylens/shared/types/entities";
import type { AppData } from "@capacitylens/shared/types/entities";
import type { StoreState } from "../store/useStore";
import { LoadError, type PersistenceAdapter } from "./PersistenceAdapter";
import { BatchReconciliationError, BatchTooLargeError } from "./ServerSyncAdapter";
import { applyOps, diffOps } from "./syncOps";

// Persistence is wired OUTSIDE the store so the store stays a pure state
// container (and is trivially testable). attachPersistence debounce-saves on
// every data change; bootstrap loads (and seeds only on a genuine first run).

interface PersistenceRegistration {
  refreshActive?: (id: string) => Promise<"reloaded" | "skipped" | "failed">;
  flushPending?: () => Promise<boolean>;
  suspendWrites?: () => (opts?: { dropParkedEdits?: boolean }) => void;
  hasUnsavedWrites: () => boolean;
}

/**
 * One owner for the currently attached persistence lifecycle. Public seams delegate to this
 * instance instead of coordinating four independent module-global callbacks.
 */
class PersistenceCoordinator {
  private registration: PersistenceRegistration | null = null;

  attach(registration: PersistenceRegistration): () => void {
    if (this.registration) {
      throw new Error("Persistence is already attached.");
    }
    this.registration = registration;
    return () => {
      if (this.registration === registration) this.registration = null;
    };
  }

  hasUnsavedWrites(): boolean {
    return this.registration?.hasUnsavedWrites() ?? false;
  }

  suspendWrites(): (opts?: { dropParkedEdits?: boolean }) => void {
    return this.registration?.suspendWrites?.() ?? (() => {});
  }

  async flushPending(): Promise<boolean> {
    return this.registration?.flushPending?.() ?? true;
  }

  async refreshActive(id: string): Promise<RefreshOutcome> {
    return this.registration?.refreshActive?.(id) ?? "unattached";
  }
}

const persistenceCoordinator = new PersistenceCoordinator();

/** Live, synchronous guard for beforeunload/UI decisions. */
export function hasUnsavedPersistenceWrites(): boolean {
  return persistenceCoordinator.hasUnsavedWrites();
}

/**
 * Suspend the orchestrator's writes and return a resume function. While suspended, edits are
 * parked, not sent; a successful reload rebases just those edits onto the fresh slice. Resume
 * decides the fate of an edit still parked when the LAST
 * suspension lifts:
 *  - default: re-schedule it — the caller's operation never replaced the slice (e.g. the import
 *    POST failed), so the parked edit is an ordinary unsaved edit and dropping it would be a
 *    silent loss;
 *  - `dropParkedEdits: true`: drop it and surface a {@link ReloadDiscardedEditError} — the
 *    caller's operation REPLACED the slice server-side but no reload reseeded the diff snapshot
 *    (the post-import re-hydrate failed or was skipped), so saving the parked edit would diff its
 *    stale pre-replacement tree against the stale snapshot and upsert ghost pre-import rows into
 *    the new slice (remapped ids insert cleanly — no 409 stops them).
 * No-op (returns a no-op resume) when no orchestrator is attached — the demo build's import is a
 * local, undoable store operation with no write pipeline to race.
 */
export function suspendServerWrites(): (opts?: { dropParkedEdits?: boolean }) => void {
  return persistenceCoordinator.suspendWrites();
}

/**
 * Outcome of {@link refreshActiveAccountSlice} (and the orchestrator's internal refreshActive):
 *  - 'reloaded'   — the server's slice was fetched AND installed; the UI shows committed state.
 *  - 'skipped'    — deliberately not performed (stale account id — the user switched tenants —
 *                   or a save is in a failed state under abortIfSaveFailed, or a newer
 *                   switch/refresh superseded this one). The store was NOT touched.
 *  - 'failed'     — the slice load threw; surfaced via onError (persist banner). Store untouched.
 *  - 'unattached' — no orchestrator (demo build / unit tests); the caller may fall back to a
 *                   bare loadAll+replaceAll, safe ONLY because there is no debounce state.
 */
export type RefreshOutcome = "reloaded" | "skipped" | "failed" | "unattached";

/**
 * Flush any pending debounced write through the orchestrator and await the round-trip.
 *
 * @returns true when writes are CLEAN afterwards (nothing pending, last write landed); false when
 *          a write is still in the failed state — the caller must not proceed with an operation
 *          (e.g. a server-side import) that assumes the local edits it just tried to land are
 *          either persisted or knowingly abandoned. Also true when no orchestrator is attached
 *          (demo build / tests): there is no debounce state to flush.
 */
export async function flushPendingWrites(): Promise<boolean> {
  return persistenceCoordinator.flushPending();
}

/**
 * Thrown (via `onError`) only when an unsaved edit cannot be safely rebased or retried: for example,
 * a prior save exhausted its retries before a mandatory tenant reload, or an external replacement
 * committed but its follow-up re-hydrate failed. Ordinary edits made during a successful reload are
 * diffed from the sequence base, rebased onto the fresh slice, and saved. A typed error lets the boot
 * wiring raise a sticky notice for the exceptional loss instead of letting the next successful load
 * immediately clear the generic persistence banner.
 */
export class ReloadDiscardedEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReloadDiscardedEditError";
  }
}

/**
 * Re-hydrate the active account's slice THROUGH the persistence orchestrator: pending debounced
 * edits are flushed and in-flight saves awaited before the reload, and the reload is skipped
 * entirely while a save is in a failed state (reloading would clobber the un-persisted edits the
 * retry machinery still holds — see refreshActive's abortIfSaveFailed note).
 *
 * @returns a {@link RefreshOutcome}. Callers whose follow-up claims "the view now shows committed
 *          state" (the server-mode import's success notice) must gate on 'reloaded' — 'skipped'
 *          and 'failed' mean the store still holds the PRE-operation slice.
 */
export async function refreshActiveAccountSlice(id: string): Promise<RefreshOutcome> {
  return persistenceCoordinator.refreshActive(id);
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
export function attachPersistence(
  store: StoreApi<StoreState>,
  adapter: PersistenceAdapter,
  debounceMs = 300,
  onError?: (e: unknown) => void,
  onSuccess?: () => void,
  serverMode = false,
): () => void {
  // Detach is an ownership boundary, not merely an event-unsubscribe. Async adapter work cannot
  // always be aborted, so every continuation checks this before it can mutate bookkeeping/store,
  // call the former owner's callbacks, refresh a slice, or schedule another write.
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastData = store.getState().data;
  let pending: AppData | null = null; // data awaiting a debounced write
  // Latest locally changed snapshot not yet confirmed by the adapter. Unlike `pending`, this remains
  // set while a request is in flight and after a failure, so lifecycle events cannot mistake a
  // dispatched-but-unacknowledged edit for clean state.
  let unacknowledged: AppData | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryAttempts = 0;
  let failedSinceSuccess = false; // a write failed and hasn't recovered — gates the online/visible re-attempt
  // The exact snapshot rejected as structurally over the atomic batch cap. Focus/online must not
  // replay it; a subsequent user edit clears the marker and gets one fresh attempt.
  let terminalBatchSnapshot: AppData | null = null;
  // True while a conflict or uncertain commit is being resolved by an authoritative reload (see
  // save's rejection arm). Guards re-entry: the reload's own entry flush can fail again if other
  // pending edits are stale, and must not recurse into an unbounded reload↔save loop.
  let resolvingAuthoritativeReload = false;
  // A reconciliation failure means the last batch either definitely conflicted or may already
  // have committed. Until loadAll installs an authoritative slice, NO path may replay the old
  // diff — including retry, focus/online recovery, import flush, or pagehide keepalive.
  let authoritativeReloadRequiredFor: string | null = null;
  // The currently-running save round-trip (P1.13): the account-switch orchestrator AWAITS it so a
  // prior account's save can't land against the new account's snapshot. Resolved (never rejected) so
  // an in-flight FAILED save can still be awaited; settles whether the save succeeds or fails.
  let inFlightSave: Promise<void> | null = null;
  const MAX_RETRY_ATTEMPTS = 5;
  // > 0 while writes are SUSPENDED (see suspendServerWrites and refreshActive): edits are parked
  // in `pending` with no timer and retries hold off. A depth, not a boolean, because an external
  // suspension (the server-mode import) and refreshActive's own suspension can overlap — and two
  // refreshActive calls can overlap each other (a switch superseding a focus refresh).
  let suspendDepth = 0;
  // The EXTERNAL subset of suspendDepth (the import seam only). Tracked separately because the
  // two kinds differ in what a keepalive unload flush may do: under an INTERNAL (reload)
  // suspension the diff snapshot is still the pre-reload one until loadAll resolves (and the
  // post-resolve stretch to replaceAll is synchronous — no unload event can interleave), so
  // flushing a parked edit on teardown diffs self-vs-self and is SAFE; under an external
  // suspension the import POST may already have replaced the slice server-side, so the same
  // flush would upsert stale pre-import rows.
  let externalSuspendDepth = 0;
  let externalBaseData: AppData | null = null;

  // The debounce/retry cancel idioms, used from many seams — one helper each so a future change
  // to their bookkeeping can't miss a copy (an uncancelled timer firing post-reseed with
  // pre-reload data is exactly the bug class this file exists to prevent).
  const cancelDebounce = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const cancelRetry = () => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };
  const acknowledge = (data: AppData) => {
    if (disposed) return;
    const acknowledgesLatest = unacknowledged === data || unacknowledged === null;
    if (unacknowledged === data) unacknowledged = null;
    if (pending === data) pending = null;
    // A response for an older snapshot cannot clear the failure/retry state of a newer write.
    if (!acknowledgesLatest) return;
    retryAttempts = 0;
    failedSinceSuccess = false;
    terminalBatchSnapshot = null;
    cancelRetry();
    onSuccess?.();
  };
  // Refresh-on-focus throttle (P1.16): coming back to the tab re-hydrates the active account's
  // slice, but a user flipping between tabs would otherwise refetch on every focus. Cap the cadence
  // to once per 30s; the timestamp is taken at refresh START so two focus events inside the window
  // collapse to a single loadAll.
  const REFRESH_MIN_INTERVAL_MS = 30_000;
  const VISIBLE_REFRESH_INTERVAL_MS = 60_000;
  let lastRefreshAt = 0;

  const save = (data: AppData) => {
    if (disposed) return;
    if (serverMode && authoritativeReloadRequiredFor !== null) {
      // Preserve the latest local snapshot as dirty for lifecycle/error reporting, but do not let
      // it reach the adapter while the commit boundary is uncertain. Recovery retries loadAll,
      // never the possibly-already-committed diff.
      unacknowledged = data;
      pending = data;
      cancelDebounce();
      cancelRetry();
      const activeId = store.getState().activeAccountId;
      if (activeId === authoritativeReloadRequiredFor) startAuthoritativeReload(activeId);
      return;
    }
    if (pending === data) pending = null;
    // Two-arg then so a throw inside onSuccess isn't misreported as a save error.
    // onSuccess lets the caller CLEAR a prior error state once a write lands again
    // — essential for the server adapter, where a transient network blip sets the
    // banner but the next successful sync should take it back down (and harmless
    // for the in-memory demo adapter).
    const round = adapter.saveAll(data).then(
      () => {
        if (disposed) return;
        // A normal save that started before a newer teardown flush must not erase that newer flush's
        // failure state. `acknowledge` applies that ordering rule for every save path.
        acknowledge(data);
      },
      (e: unknown) => {
        if (disposed) return;
        failedSinceSuccess = true;
        // The banner must surface EVERY failed write — including a conflict, where the user's
        // edit is about to be discarded (server wins below); they must learn it did not save.
        onError?.(e);
        // A deterministic 400/409 rejection and a malformed 2xx commit receipt all require an
        // authoritative reload. Rejections would repeat forever if retried; an uncertain receipt
        // may already have committed, so replaying against the prior snapshot is unsafe. This reload deliberately bypasses
        // abortIfSaveFailed because it is the resolution, not an ordinary focus refresh.
        if (serverMode && e instanceof BatchReconciliationError) {
          // Never re-arm backoff with a stale or commit-uncertain diff.
          cancelRetry();
          const activeId = store.getState().activeAccountId;
          // A nested reconciliation failure, or no active account to reload, is surfaced without
          // recursion. Keep the write gate raised until a completed reload reseeds the snapshot.
          if (activeId !== null) {
            authoritativeReloadRequiredFor = activeId;
            startAuthoritativeReload(activeId);
          }
          return;
        }
        // An over-limit diff is TERMINAL, not transient: the atomic batch refuses to split it, so
        // the identical over-limit diff would throw on every backoff attempt — a permanent
        // auto-retrying banner. Surface it (onError already raised the banner + a clear sticky
        // notice) and STOP: never arm the exponential-backoff loop against a diff that can't land.
        // The desired state stays in memory and the banner clears once a later, smaller diff (the
        // user changing fewer items at once) syncs. Reloading before that discards the unsaved edit.
        // Focus/online recovery also declines this exact snapshot; a fresh edit clears the marker
        // and earns one new attempt in case the resulting delta is now small enough.
        if (serverMode && e instanceof BatchTooLargeError) {
          terminalBatchSnapshot = data;
          cancelRetry();
          return;
        }
        scheduleRetry();
      },
    );
    // Track the round-trip so the switch orchestrator can await it (it never rejects — both arms
    // above settle it). Clear the handle only if it's still THIS round (a newer save may have
    // replaced it mid-flight).
    inFlightSave = round;
    void round.finally(() => {
      if (inFlightSave === round) inFlightSave = null;
    });
  };

  // Re-attempt a STRANDED write (one that failed and exhausted its retry budget) when the
  // connection plausibly recovers — the browser fires `online`, or the user returns to the
  // tab. Resets the budget and re-sends the latest store state; the adapter's diff is empty
  // when it's actually already synced, so this is a no-op.
  // Gated on a real prior failure so an idle online/focus event never triggers one.
  const retryStrandedWrite = () => {
    if (disposed) return;
    if (!failedSinceSuccess) return;
    if (suspendDepth > 0) return; // suspended: a replay would race the suspending operation's slice replacement
    const retryData = unacknowledged ?? store.getState().data;
    if (terminalBatchSnapshot === retryData) return;
    cancelRetry();
    retryAttempts = 0;
    save(retryData);
  };

  // A failed write (e.g. the server is briefly unreachable) is retried in the
  // background with exponential backoff, re-sending the LATEST store state, so a
  // transient failure self-heals WITHOUT waiting for the user's next edit. Without
  // this, a reload after the server recovered but before the next edit would lose the
  // unsynced changes (server-backed mode has no localStorage fallback). Capped so a
  // permanently-rejected write doesn't retry forever; a fresh user edit (see the
  // subscribe handler) resets the budget.
  const scheduleRetry = () => {
    if (disposed) return;
    if (retryTimer || retryAttempts >= MAX_RETRY_ATTEMPTS) return;
    if (suspendDepth > 0) return; // suspended: don't re-arm a replay under a slice replacement
    const delay = Math.min(1000 * 2 ** retryAttempts, 30000);
    retryAttempts += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (disposed) return;
      if (suspendDepth > 0) return;
      save(unacknowledged ?? store.getState().data);
    }, delay);
  };

  // Flush the latest UNACKNOWLEDGED write on page teardown via the adapter's `unload` path: it
  // DISPATCHES every op up-front (keepalive), where a normal sequential server drain would
  // only get the first request on the wire before the event loop dies. CONDITIONAL on
  // The snapshot remains tracked until the adapter confirms it, including while an ordinary save
  // is already in flight.
  const flushOnUnload = () => {
    if (disposed) return;
    // Under an EXTERNAL suspension (the server-mode import): a parked edit predates a slice
    // replacement that may already be committed server-side — pushing it via keepalive would diff
    // it against the stale pre-import snapshot and upsert ghost rows into the imported slice.
    // Decline; a successful import reload rebases it, while a failed re-hydrate's explicit resume
    // policy owns it. An INTERNAL (reload)
    // suspension deliberately does NOT block this flush: until loadAll resolves the snapshot is
    // still the pre-reload one (and the post-resolve stretch to replaceAll is synchronous — no
    // unload event can interleave), so the keepalive diff is self-vs-self and SAFE — declining
    // would silently lose an edit made during a reload window on every tab close.
    if (externalSuspendDepth > 0) {
      if (unacknowledged) {
        onError?.(
          new ReloadDiscardedEditError(
            "An edit was still parked while this company’s data was being replaced during page teardown.",
          ),
        );
      }
      return;
    }
    if (authoritativeReloadRequiredFor !== null) return;
    cancelDebounce();
    const data = unacknowledged;
    if (!data) return;
    // Never consume before confirmation. If pagehide was a bfcache transition and the page survives,
    // success clears this exact snapshot; failure is surfaced and enters the normal retry machinery.
    void adapter.saveAll(data, { unload: true }).then(
      () => {
        if (disposed) return;
        acknowledge(data);
      },
      (error: unknown) => {
        if (disposed) return;
        failedSinceSuccess = true;
        onError?.(error);
        if (serverMode && error instanceof BatchReconciliationError) {
          cancelRetry();
          const activeId = store.getState().activeAccountId;
          if (activeId !== null) {
            authoritativeReloadRequiredFor = activeId;
            startAuthoritativeReload(activeId);
          }
          return;
        }
        scheduleRetry();
      },
    );
  };

  // visibilitychange is an ordinary surviving-page event, not teardown. Flush through the normal
  // serialized adapter queue so failures surface/retry and an existing save cannot be overtaken.
  const flushWhileAlive = () => {
    if (disposed) return;
    if (externalSuspendDepth > 0) return;
    cancelDebounce();
    if (unacknowledged) save(unacknowledged);
  };

  // Set by the account-switch orchestrator (below) around its replaceAll(newSlice) so the data
  // subscription treats the slice LOAD as a tenant change, NOT a user edit — without it the loaded
  // slice would be diffed against the OLD account's snapshot and pushed back as a spurious (and, in
  // server mode, CROSS-ACCOUNT) save. The orchestrator advances lastData itself in lockstep.
  let loadingSlice = false;

  const unsubscribe = store.subscribe((state) => {
    if (disposed) return;
    if (state.data === lastData) return; // only persist when data actually changes
    lastData = state.data;
    // The orchestrator's slice load is not a user edit — track lastData (done) but DON'T save it.
    if (loadingSlice) return;
    unacknowledged = state.data;
    terminalBatchSnapshot = null;
    // Suspended (a slice replacement is in flight): PARK the edit — record it in `pending` with no
    // timer so nothing sends it. It is rebased by a successful reload, or re-scheduled on resume
    // when the suspending operation failed before any reload.
    if (suspendDepth > 0) {
      pending = state.data;
      return;
    }
    retryAttempts = 0; // a fresh user change earns a fresh retry budget
    if (debounceMs <= 0) {
      save(state.data);
      return;
    }
    pending = state.data;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => save(state.data), debounceMs);
  });

  // Demo/local mode: adopt another tab's whole-tree write only while this tab is clean. The
  // adapter's compare-and-swap revision independently rejects a racing save; this listener keeps
  // an idle tab current instead of letting two full snapshots silently overwrite each other.
  const unsubscribeExternal = adapter.subscribeExternal?.((data) => {
    if (disposed) return false;
    if (pending || inFlightSave || failedSinceSuccess || suspendDepth > 0) {
      onError?.(new Error("Data changed in another tab while this tab had unsaved changes. Reload to reconcile."));
      return false;
    }
    loadingSlice = true;
    store.getState().replaceAll(data);
    lastData = store.getState().data;
    loadingSlice = false;
    return true;
  });

  // ── Account-switch orchestrator (P1.13) — the §5 correctness core. ───────────────────────────────
  // In SERVER mode only: when the active account changes to a NON-NULL id, hydrate THAT account's
  // slice and re-seed the adapter's diff snapshot to it ATOMICALLY, so a save can never diff one
  // account's data against another's snapshot (which would emit DELETEs for account A + PUTs for
  // account B → cross-account data loss). In the DEMO build / OFF this is INERT — `data` already holds all
  // accounts, so a switch is a pure view change with nothing to load.
  //
  // This sets up switchToken / lastActiveAccountId and delegates the per-switch (a)/(a′)/(b)/(c)
  // sequence to refreshActive — see its doc below for the authoritative narration. The only
  // switch-specific case is a NULL id (dropped to the picker / sign-out): that loads nothing (see the
  // subscribe handler below), it just flushes the old account's pending edits.
  let switchToken = 0;
  let lastActiveAccountId = store.getState().activeAccountId;

  // Re-hydrate ONE non-null account's slice and re-seed the adapter's diff snapshot to it,
  // ATOMICALLY — the shared body of both a tenant SWITCH (newId) and a refresh-on-focus
  // (activeId). Extracted (P1.16) precisely so refresh REUSES this exact sequence: the snapshot
  // (adapter.lastSynced) is private to the adapter and is re-seeded ONLY by loadAll, so a parallel
  // re-hydrate path (e.g. a React hook calling replaceAll) would leave `data` updated but the
  // snapshot stale → the next save would diff the fresh slice against the old snapshot and emit a
  // cross-account / garbage delta. The token discipline below also makes a late refresh that
  // resolves after a newer switch/refresh a no-op, so the two callers can't clobber each other.
  //
  // A per-switch token guards the whole sequence: each call bumps `switchToken`, and a SECOND
  // switch/refresh that supersedes a slow first one makes the first's late-resolving load a no-op
  // (it must not seed a stale account over the newer one).
  //
  // SEQUENCE (token-guarded throughout, see the inline (a)/(a′)/(b)/(c) markers):
  //   (a) await any in-flight save so a prior write can't land against the new snapshot;
  //  (a′) FLUSH (not drop) the current account's pending debounced edits while data AND the snapshot
  //       are BOTH still this account → the diff is self-vs-self (correct), landed BEFORE (b) reseeds;
  //   (b) adapter.loadAll(id) → returns the slice AND re-seeds lastSynced to it;
  //   (c) replaceAll(slice) under loadingSlice so the data subscription doesn't read it as an edit,
  //       then advance lastData.
  //
  // Mid-load edits are preserved as operations, not as a stale whole tree. At (c), diffOps derives
  // only the changes made during this sequence and applyOps rebases them onto the freshly loaded
  // server slice. This retains remote additions/lifecycle changes and avoids resurrecting rows,
  // while the rebased state is parked for an ordinary confirmed save after suspension lifts.
  //
  // abortIfSaveFailed (refresh-on-focus + the lifecycle hook's post-mutation reload — NOT tenant
  // switches): when the flush/await above still leaves a save FAILED, the refresh is ABANDONED.
  // Proceeding would loadAll+replaceAll the server's copy over the optimistic state AND re-seed the
  // diff snapshot to it, so the scheduled retry (which re-reads store state) would diff to ZERO ops,
  // "succeed", and clear the failure — permanently discarding the user's un-persisted edit. Aborting
  // keeps the edit in play: the retry/stranded-write machinery still holds it, and the persist banner
  // (raised via save's onError) already tells the user they're not synced. A tenant SWITCH deliberately
  // does NOT abort — refusing the load would leave account A's data rendered under account B's id (a
  // cross-tenant display, strictly worse); its flush failure is surfaced the same way and the loss is
  // bounded to the un-flushed edits.
  // Begin a write suspension. Cancels the armed debounce (parking its edit — `pending` already
  // holds the data) and bumps the depth so the subscribe handler parks instead of scheduling.
  // The returned resume decrements exactly once; when the LAST suspension lifts with an edit
  // still parked, it decides its fate (see suspendServerWrites' doc):
  //  - default: re-schedule it — nothing replaced the slice, so it is an ordinary unsaved edit;
  //  - dropParkedEdits: drop + surface — the slice WAS replaced server-side but no reload
  //    reseeded the snapshot, so saving it would upsert its stale tree into the new slice.
  // When another suspension still holds the depth, the parked edit is left for THAT holder: a
  // newer refresh either flushes it at its own (a′) or rebases it at its own (c).
  const beginSuspension = (external: boolean): ((opts?: { dropParkedEdits?: boolean }) => void) => {
    if (disposed) return () => {};
    suspendDepth += 1;
    if (external) {
      if (externalSuspendDepth === 0) externalBaseData = store.getState().data;
      externalSuspendDepth += 1;
    }
    cancelDebounce();
    cancelRetry();
    let resumed = false;
    return (opts = {}) => {
      if (disposed) return;
      if (resumed) return; // resume is idempotent — a double call must not underflow the depth
      resumed = true;
      suspendDepth -= 1;
      if (external) {
        externalSuspendDepth -= 1;
      }
      // A nested reload may outlive the external import suspension and still need this base for
      // its operation-level rebase. Once the LAST suspension releases, however, no path may retain
      // the pre-import tree — including the parked-edit drop arm below.
      if (suspendDepth > 0) return;
      if (!pending) {
        externalBaseData = null;
        if (failedSinceSuccess && authoritativeReloadRequiredFor === null) scheduleRetry();
        return;
      }
      if (opts.dropParkedEdits) {
        pending = null;
        unacknowledged = null;
        externalBaseData = null;
        onError?.(
          new ReloadDiscardedEditError(
            "An edit arrived while this company’s data was being replaced and could not be saved.",
          ),
        );
      } else {
        const parked = pending;
        externalBaseData = null;
        save(parked);
      }
    };
  };

  const refreshActive = async (
    id: string,
    opts: { abortIfSaveFailed?: boolean } = {},
  ): Promise<"reloaded" | "skipped" | "failed"> => {
    const { abortIfSaveFailed = false } = opts;
    // ENTRY GUARD — before the token bump. An out-of-band caller with a STALE id (the lifecycle
    // hook's post-mutation reload resolving after the user switched tenant A→B) must neither
    // reload the wrong tenant NOR cancel a newer switch's in-flight slice load — bumping
    // switchToken here would do exactly that: B's late-resolving loadAll hits `myToken !==
    // switchToken` and is discarded while A's stale slice is installed under B's active id
    // (cross-tenant display, then cross-tenant writes). The switch subscriber calls refreshActive
    // AFTER setActiveAccount has already set the id, so this guard passes for every real switch;
    // mid-flight supersession is still covered by the post-await token checks below.
    if (disposed || store.getState().activeAccountId !== id) return "skipped";
    // Focus and post-lifecycle refreshes are conveniences, never owners of an account transition.
    // If a switch/refresh already holds an internal slice suspension, starting another abortable refresh
    // would bump its token and could then abort on failedSinceSuccess without issuing a replacement
    // load. The older load would have re-seeded the adapter but be forbidden to install its slice,
    // leaving one tenant's data paired with another tenant's diff snapshot. An external import
    // suspension is excluded: its owner deliberately invokes this refresh to reseed after import.
    if (abortIfSaveFailed && suspendDepth > externalSuspendDepth) return "skipped";
    const myToken = ++switchToken;
    // The ENTIRE sequence runs under a write suspension — not just loadAll. An edit landing during
    // ANY await below is parked: it is included in the (a′) flush when it arrives before it (the
    // parked tree is the whole store snapshot, so the flush carries it — safe pre-reseed), and
    // rebased at (c) when it arrives after. Without whole-sequence coverage, an edit
    // arriving during the (a)/(a′) awaits re-armed a debounce timer at depth 0 that fired MID-LOAD:
    // its save was silently discarded by the adapter's seedGen guard, the (c) check couldn't see it
    // (pending consumed, dataAtLoad snapshotted later), and the edit vanished with no surface.
    // The finally-resume also re-schedules an edit left parked by an ordinary FAILED load (slice +
    // snapshot unchanged → saving is correct). When this load is required to reconcile an unknown
    // commit, save's gate retains the edit without replaying it until a later load succeeds.
    const dataAtSequenceStart = store.getState().data;
    const resume = beginSuspension(false);
    try {
      // (a) Let a prior account's save settle before we re-seed the snapshot.
      if (inFlightSave) await inFlightSave;
      if (disposed || myToken !== switchToken) return "skipped"; // detached/newer owner owns effects
      // (a′) FLUSH (don't drop) the current account's PENDING debounced edits before we re-seed.
      // Merely dropping them would LOSE edits made within the debounce window of a switch/refresh.
      // Flush NOW — while data AND the adapter's lastSynced snapshot are both this account — so
      // `save()` diffs self-against-self (correct ops) and POSTs them, BEFORE loadAll(id) reseeds
      // the snapshot. A flush failure surfaces via save's onError and we still proceed — the loss
      // is then surfaced again at (c) via failedSinceSuccess. (Refresh-on-focus relies on this:
      // the user's unsaved edits POST first, then loadAll → last-writer-wins, the user winning.)
      // NOT under an EXTERNAL suspension: that `pending` is an edit that arrived while the
      // server-mode import was in flight — flushing it would diff it against the PRE-import
      // snapshot and upsert stale rows into the freshly imported slice (remapped ids insert
      // cleanly, no 409 stops them). Leave it parked for (c)'s operation-level rebase.
      if (pending && externalSuspendDepth === 0) {
        save(pending); // sets inFlightSave synchronously; pending is consumed inside save()
        if (inFlightSave) await inFlightSave;
        if (disposed || myToken !== switchToken) return "skipped"; // detached/newer owner owns effects
      }
      // See the abortIfSaveFailed doc above: a refresh must not reload over a failed save's edits.
      // Checked AFTER the flush/await so a flush that just SUCCEEDED (clearing the flag) still refreshes.
      if (abortIfSaveFailed && failedSinceSuccess) return "skipped";
      // A pre-armed backoff retry must not survive into the load: it would fire mid-load, its
      // stale save silently discarded by the seedGen guard while the success arm below cleared
      // the failure state — hiding the loss. Cancel it; the loss it carried is surfaced at (c).
      cancelRetry();
      // Snapshot the store state the reload starts from, so an edit landing DURING loadAll is
      // detectable below — a bare `pending` check alone can't see it (an immediate-mode save nulls
      // pending while the edit's data is already in the store).
      const dataAtLoad = store.getState().data;
      // (b) Load the slice; loadAll(id) re-seeds the adapter's diff snapshot to it. Writes stay
      // suspended so an edit arriving mid-load is parked and can be rebased after the response,
      // never raced onto the server against the old snapshot.
      // Capture failure state at this boundary. A teardown keepalive may fail DURING loadAll, but
      // its mid-load edit is rebased below and is not discarded; only a failure already present
      // before the loaded slice was requested can describe older state that replacement loses.
      const failedBeforeLoad = failedSinceSuccess;
      const slice = await adapter.loadAll(id);
      if (disposed) return "skipped";
      if (myToken !== switchToken) {
        // Superseded AFTER loadAll resolved: the load has already RESEEDED the adapter's diff
        // snapshot, and the superseding token bump may install nothing over it (the null-switch /
        // A newer refresh owns any parked edit. A sign-out, however, starts no replacement load:
        // preserve only the operations made during this window by rebasing them onto the slice
        // that just seeded the adapter, then install that same tree behind the signed-out picker.
        // activeAccountId stays null, so no tenant UI is exposed; the hidden store and adapter seed
        // nevertheless remain paired unconditionally instead of diverging in the no-edit case.
        if (store.getState().activeAccountId === null) {
          const currentData = store.getState().data;
          let installed = slice;
          if (currentData !== dataAtLoad || pending !== null) {
            installed = applyOps(slice, diffOps(dataAtSequenceStart, currentData));
            pending = null;
            unacknowledged = installed;
            save(installed);
            if (inFlightSave) await inFlightSave;
          }
          loadingSlice = true;
          store.getState().replaceAll(installed);
          lastData = store.getState().data;
          loadingSlice = false;
        }
        return "skipped"; // superseded mid-load — discard this stale slice
      }
      // (c) Mid-load edit check — see the rebase-policy doc above the function. Three signals count:
      // a changed data reference (the edit is in the store, saved or not), a non-null `pending`
      // (a parked edit), or failedSinceSuccess (a switch/conflict path proceeded past a FAILED
      // (a′) flush — those un-persisted edits are about to be discarded by the replaceAll below,
      // and the success arm then clears the banner that was their only surface; the sticky notice
      // raised here replaces it). An authoritative reconciliation reload is exempt from the third
      // signal: its typed failure arm already raised the appropriate sticky notice for the same
      // potentially lost edit.
      const currentData = store.getState().data;
      const editedMidLoad = currentData !== dataAtLoad || pending !== null;
      const lostFailedEdits = failedBeforeLoad && !resolvingAuthoritativeReload;
      let installed = slice;
      if (editedMidLoad) {
        // Rebase only the operations the user performed during this network window onto the fresh
        // server slice. This preserves remote additions and lifecycle/import changes while keeping
        // the user's concurrent edit. The adapter was seeded to `slice`; parking `installed` makes
        // the resumed save diff and commit this rebased state normally (and durably).
        const editBase = externalSuspendDepth > 0 && externalBaseData ? externalBaseData : dataAtSequenceStart;
        installed = applyOps(slice, diffOps(editBase, currentData));
        pending = installed;
        unacknowledged = installed;
      } else if (lostFailedEdits) {
        pending = null;
        unacknowledged = null;
      }
      // A successfully rebased mid-load edit and an older discarded failed write are independent
      // outcomes. Preserve the former above, but always surface the latter before clearing the
      // transient transport-failure state below.
      if (lostFailedEdits) {
        onError?.(new ReloadDiscardedEditError("An edit could not be saved before this company’s data reloaded."));
      }
      // Swap `data` to the loaded slice WITHOUT it reading as a user edit, then advance lastData.
      loadingSlice = true;
      store.getState().replaceAll(installed);
      lastData = store.getState().data;
      loadingSlice = false;
      if (!editedMidLoad) unacknowledged = null;
      authoritativeReloadRequiredFor = null;
      // The store now holds the server's authoritative slice and the snapshot is re-seeded to it —
      // writes are CLEAN by construction, whatever their history. Clear the failure state and fire
      // onSuccess (mirrors the 409 arm's follow-up empty save, which exists for the same reason):
      //  - a prior tenant's exhausted-retry failure must not leak into this tenant (it would block
      //    an import here via flushPendingWrites and suppress focus refreshes via abortIfSaveFailed);
      //  - a rebase is followed by a normal save when suspension resumes; this success marks the
      //    transport healthy without discarding either local or remote changes.
      // Any loss this clearing could have hidden was surfaced by the (c) check above.
      failedSinceSuccess = false;
      retryAttempts = 0;
      cancelRetry();
      onSuccess?.();
      return "reloaded";
    } catch (e) {
      // A failed slice load surfaces like any load failure: raise the persist banner (a stale
      // banner clears on the next good write). Don't replaceAll — leaving the prior data is
      // safer than blanking it, and the snapshot is unchanged so no bad diff can form. An edit
      // parked during the failed load is re-scheduled by the finally-resume below.
      if (disposed || myToken !== switchToken) return "skipped"; // detached/newer owner owns outcome
      onError?.(e);
      return "failed";
    } finally {
      resume();
    }
  };

  // Resolve a stale/uncertain batch boundary exactly once at a time. A failed load deliberately
  // leaves authoritativeReloadRequiredFor set: subsequent online/focus activity retries the load,
  // while every write entry point remains closed. Only a successful reload permits the clean
  // acknowledgement/rebased follow-up write.
  function startAuthoritativeReload(activeId: string): void {
    if (disposed || resolvingAuthoritativeReload) return;
    resolvingAuthoritativeReload = true;
    void refreshActive(activeId)
      .then((outcome) => {
        if (disposed || outcome !== "reloaded") return;
        // One follow-up save makes an empty diff acknowledge recovery, or lands only edits made
        // during the reload after refreshActive rebased them onto the authoritative slice.
        if (store.getState().activeAccountId !== activeId) return;
        if (inFlightSave) return inFlightSave;
        save(store.getState().data);
        return inFlightSave ?? undefined;
      })
      .finally(() => {
        resolvingAuthoritativeReload = false;
      });
  }

  const unsubscribeSwitch = serverMode
    ? store.subscribe((state) => {
        const newId = state.activeAccountId;
        if (newId === lastActiveAccountId) return;
        lastActiveAccountId = newId;
        // Null (dropped to the picker / sign-out) loads nothing — the picker shows accountSummaries,
        // and the next non-null pick will hydrate. Cancel any in-flight switch so its late load can't
        // seed. Still FLUSH the OLD account's pending debounced edits first (same data-loss edge as a
        // real A→B switch): data and the snapshot are both still account A here, so the flush diffs
        // A-vs-A correctly. No loadAll follows, so there's no later snapshot reseed to race.
        if (newId === null) {
          const myToken = ++switchToken;
          void (async () => {
            if (inFlightSave) await inFlightSave;
            if (disposed || myToken !== switchToken) return; // detached/newer owner owns effects
            cancelDebounce();
            // A parked edit belongs to whichever slice replacement still holds the suspension.
            // A token bump supersedes an internal refresh's outcome, not its outstanding load or
            // suspension; that refresh rebases and saves the edit when it settles.
            if (pending && suspendDepth === 0) {
              save(pending);
              if (inFlightSave) await inFlightSave;
            }
          })();
          return;
        }
        void refreshActive(newId);
      })
    : null;

  // The debounce window can outlive the tab. `pagehide` is the reliable close/navigate signal
  // (including bfcache) and uses keepalive; `visibilitychange → hidden` covers ordinary tab switches
  // and mobile lifecycle changes through the normal serialized save path. The unacknowledged snapshot
  // remains tracked until either path confirms it, so either event may safely follow the other.
  // Coming BACK to the tab (or the browser firing `online`) re-attempts a stranded write.
  // Refresh-on-focus (P1.16): when the user returns to the tab/window, re-hydrate the active
  // account's slice so a change made in another tab/device shows up — REUSING refreshActive (the
  // switch orchestrator's body) so the private lastSynced snapshot is re-seeded atomically and stays
  // consistent with `data` (a parallel re-hydrate would desync them and emit a garbage diff). Guards:
  // SERVER mode only (refreshActive only re-seeds meaningfully when serverMode; local already holds
  // every account); SKIP when there's no active account (on the picker — nothing to refresh); and
  // THROTTLE to REFRESH_MIN_INTERVAL_MS. Unsaved-edit safety is INHERENT — refreshActive flushes
  // pending + awaits inFlightSave BEFORE loadAll, so the user's edits POST first (last-writer-wins).
  const maybeRefreshActiveSlice = () => {
    if (disposed) return;
    if (!serverMode) return;
    const id = store.getState().activeAccountId;
    if (id === null) return; // on the picker — nothing to refresh
    if (authoritativeReloadRequiredFor === id) {
      startAuthoritativeReload(id);
      return;
    }
    const now = Date.now();
    if (now - lastRefreshAt <= REFRESH_MIN_INTERVAL_MS) return;
    lastRefreshAt = now; // stamp at refresh START so two focuses inside the window collapse to one
    void refreshActive(id, { abortIfSaveFailed: true }).then((outcome) => {
      // A skipped refresh never reached the server. Do not let a failed-write guard or a superseded
      // owner consume the throttle and suppress the next genuine recovery event. Preserve a newer
      // refresh's timestamp if one started while this attempt was settling.
      if (outcome === "skipped" && lastRefreshAt === now) lastRefreshAt = 0;
    }); // a focus refresh must never clobber failed-save edits
  };

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
        if (disposed) return false;
        if (authoritativeReloadRequiredFor !== null) return false;
        // Suspended: another slice replacement is already in flight — writes are NOT clean and
        // flushing the parked edit would push it against a mid-replacement snapshot. Refuse.
        if (suspendDepth > 0) return false;
        // Loop until QUIESCENT, not just one round: writes are unsuspended during the await, so
        // an edit landing mid-flush arms a fresh debounce whose save can outlive a single await —
        // a one-shot flush would then return "clean" while that save is still on the wire, and
        // the caller's import POST would race it (the exact pre-suspension window the whole
        // import sequence exists to close). Terminates when a full round finds nothing new.
        const deadline = Date.now() + 120_000;
        let rounds = 0;
        while (!disposed && (timer || pending || inFlightSave) && rounds < 100 && Date.now() < deadline) {
          rounds += 1;
          cancelDebounce();
          if (pending) save(pending); // consumes pending, sets inFlightSave synchronously
          if (inFlightSave) await inFlightSave;
          if (suspendDepth > 0) return false;
        }
        return (
          !disposed &&
          suspendDepth === 0 &&
          !timer &&
          !pending &&
          !inFlightSave &&
          !failedSinceSuccess &&
          unacknowledged === null
        );
      }
    : null;
  // Write-suspension seam (see suspendServerWrites' doc for the resume contract) — the EXTERNAL
  // variant of beginSuspension, registered for the server-mode import.
  const myRegisteredSuspend = serverMode ? () => beginSuspension(true) : null;
  const myRegisteredHasUnsaved = () =>
    !disposed &&
    (unacknowledged !== null ||
      pending !== null ||
      inFlightSave !== null ||
      failedSinceSuccess ||
      authoritativeReloadRequiredFor !== null);
  const unregisterCoordinator = persistenceCoordinator.attach({
    ...(myRegisteredRefresh ? { refreshActive: myRegisteredRefresh } : {}),
    ...(myRegisteredFlush ? { flushPending: myRegisteredFlush } : {}),
    ...(myRegisteredSuspend ? { suspendWrites: myRegisteredSuspend } : {}),
    hasUnsavedWrites: myRegisteredHasUnsaved,
  });

  const onPageHide = () => flushOnUnload();
  const onVisibility = () => {
    if (typeof document === "undefined") return;
    if (document.visibilityState === "hidden") flushWhileAlive();
    else {
      retryStrandedWrite();
      maybeRefreshActiveSlice(); // returning via tab-switch/mobile also re-hydrates (throttled)
    }
  };
  const onOnline = () => retryStrandedWrite();
  // A bare window `focus` covers regaining focus without a visibility change (e.g. alt-tab back to
  // an already-visible window). Match visibility→visible by retrying any stranded write before the
  // shared throttled refresh; refreshActive then waits for that write and reloads only if it lands.
  const onFocus = () => {
    retryStrandedWrite();
    maybeRefreshActiveSlice();
  };
  const canListen = typeof window !== "undefined";
  if (canListen) {
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
  }
  // A continuously focused tab emits neither focus nor visibility events. Poll only while visible
  // in server mode so multi-writer sessions converge without waiting for their next conflicting
  // edit. The ordinary refresh throttle still coalesces this with a recent focus-triggered load.
  const visibleRefreshTimer =
    canListen && serverMode
      ? setInterval(() => {
          if (document.visibilityState === "visible") maybeRefreshActiveSlice();
        }, VISIBLE_REFRESH_INTERVAL_MS)
      : null;

  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    unsubscribeExternal?.();
    unsubscribeSwitch?.();
    unregisterCoordinator();
    if (canListen) {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    }
    if (visibleRefreshTimer) clearInterval(visibleRefreshTimer);
    cancelDebounce(); // cancel any pending debounced write
    cancelRetry(); // cancel any pending background retry
  };
}

export interface BootstrapOptions {
  debounceMs?: number;
  /** Used only on a genuine first run (nothing ever persisted). */
  seedIfEmpty?: AppData;
  /** Called when a persistence write fails (e.g. storage quota exceeded, or the
   *  server is unreachable). */
  onError?: (e: unknown) => void;
  /** Called after a persistence write succeeds — lets the caller clear a prior
   *  error state once saving recovers (e.g. the server comes back). */
  onSuccess?: () => void;
  /** True when a backend is in use — server mode (the default; false only in the demo build,
   *  VITE_CAPACITYLENS_DEMO=1). Enables the per-account switch
   *  orchestrator (P1.13): a tenant pick hydrates that account's slice via `loadAll(accountId)` and
   *  re-seeds the diff snapshot atomically. The demo build (false) leaves the orchestrator inert — `data`
   *  already holds all accounts, so a switch is a pure view change. */
  serverMode?: boolean;
}

export async function bootstrap(
  store: StoreApi<StoreState>,
  adapter: PersistenceAdapter,
  opts: BootstrapOptions = {},
): Promise<() => void> {
  let loaded: AppData;
  try {
    loaded = await adapter.loadAll();
  } catch (e) {
    // Stored data couldn't be loaded. Render an empty dataset, but DELIBERATELY
    // attach NO persistence and run NO seed-save — the next mutation must not
    // overwrite recoverable data. Route to the recovery UI that fits the failure:
    //   - 'unavailable' (a remote/server load failed): a retry screen. Clearing
    //     local storage would do nothing for a server-backed app that's merely down.
    //   - 'corrupt' (local bytes present but unreadable) or any other throw: the
    //     StorageRecovery reset/import/export screen.
    store.getState().replaceAll(emptyAppData());
    store.getState().setHydrated(true);
    if (e instanceof LoadError && e.kind === "unavailable") {
      store.getState().setConnectionError(true);
    } else {
      store.getState().setLoadError(true);
    }
    return () => {};
  }
  // Seed only when nothing was ever stored — never resurrect data the user cleared.
  // hasExisting (e.g. the server's /api/meta) decides ONLY whether to seed. If it throws
  // AFTER a successful load, don't discard the loaded data or skip attaching persistence
  // (which would brick saving and show a misleading banner) — fall back to inferring
  // existence from the loaded data itself, so we still skip seeding when there's data.
  let existed: boolean;
  try {
    existed = adapter.hasExisting ? await adapter.hasExisting() : !isEmpty(loaded);
  } catch (e) {
    // hasExisting failed AFTER a good load (e.g. the server's /api/meta blipped). The fallback is
    // safe — infer existence from the loaded data, so we still skip seeding when there's data — but
    // leave a dev breadcrumb so a totally-silent meta failure isn't invisible while debugging.
    // Deliberately NOT routed to onError: this is non-fatal and would wrongly raise the persist banner.
    console.warn("bootstrap: hasExisting() failed; inferring existence from loaded data", e);
    existed = !isEmpty(loaded);
  }
  const seedNeeded = !existed && !!opts.seedIfEmpty;
  const initial = seedNeeded ? (opts.seedIfEmpty as AppData) : loaded;

  store.getState().replaceAll(initial);
  store.getState().setHydrated(true);
  // Guard the first-run seed write: a failure here (quota / private mode) must
  // surface via onError AND must NOT stop persistence from being attached —
  // otherwise the session would silently never save and never show the banner.
  if (seedNeeded) {
    try {
      await adapter.saveAll(initial);
    } catch (e) {
      opts.onError?.(e);
    }
  }

  return attachPersistence(store, adapter, opts.debounceMs ?? 300, opts.onError, opts.onSuccess, opts.serverMode);
}
