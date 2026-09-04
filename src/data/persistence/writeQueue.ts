import type { StoreApi } from "zustand";
import type { AppData } from "@capacitylens/shared/types/entities";
import type { StoreState } from "../../store/useStore";
import type { PersistenceAdapter } from "../PersistenceAdapter";
import { BatchTooLargeError } from "../ServerSyncAdapter";
import { incrementPersistenceDiagnostic } from "../persistenceDiagnostics";
import type { AttachmentState } from "./attachmentState";

export function createWriteQueue(
  store: StoreApi<StoreState>,
  adapter: PersistenceAdapter,
  owner: AttachmentState,
  serverMode: boolean,
  startAuthoritativeReload: (id: string) => void,
  onError?: (e: unknown) => void,
) {
  const MAX_RETRY_ATTEMPTS = 5;
  const { cancelDebounce, cancelRetry, acknowledge, discardEdit } = owner;
  const beginAuthoritativeReloadFor = (error: unknown) =>
    owner.beginAuthoritativeReloadFor(error, serverMode, startAuthoritativeReload);

  const save = (data: AppData) => {
    if (owner.current.disposed) return;
    if (serverMode && owner.current.authoritativeReloadRequiredFor !== null) {
      // Preserve the latest local snapshot as dirty for lifecycle/error reporting, but do not let
      // it reach the adapter while the commit boundary is uncertain. Recovery retries loadAll,
      // never the possibly-already-committed diff.
      owner.update({ unacknowledged: data });
      owner.update({ pending: data });
      cancelDebounce();
      cancelRetry();
      const activeId = store.getState().activeAccountId;
      if (activeId === owner.current.authoritativeReloadRequiredFor) startAuthoritativeReload(activeId);
      return;
    }
    if (owner.current.pending === data) owner.update({ pending: null });
    // Two-arg then so a throw inside onSuccess isn't misreported as a save error.
    // onSuccess lets the caller CLEAR a prior error state once a write lands again
    // — essential for the server adapter, where a transient network blip sets the
    // banner but the next successful sync should take it back down (and harmless
    // for the in-memory demo adapter).
    const round = adapter.saveAll(data).then(
      () => {
        if (owner.current.disposed) return;
        // A normal save that started before a newer teardown flush must not erase that newer flush's
        // failure state. `acknowledge` applies that ordering rule for every save path.
        acknowledge(data);
      },
      (e: unknown) => {
        if (owner.current.disposed) return;
        owner.update({ failedSinceSuccess: true });
        incrementPersistenceDiagnostic("savesFailed");
        // The banner must surface EVERY failed write — including a conflict, where the user's
        // edit is about to be discarded (server wins below); they must learn it did not save.
        onError?.(e);
        // A deterministic 400/409 rejection and a malformed 2xx commit receipt all require an
        // authoritative reload. Rejections would repeat forever if retried; an uncertain receipt
        // may already have committed, so replaying against the prior snapshot is unsafe. This reload deliberately bypasses
        // abortIfSaveFailed because it is the resolution, not an ordinary focus refresh.
        if (beginAuthoritativeReloadFor(e)) return;
        // An over-limit diff is TERMINAL, not transient: the atomic batch refuses to split it, so
        // the identical over-limit diff would throw on every backoff attempt — a permanent
        // auto-retrying banner. Surface it (onError already raised the banner + a clear sticky
        // notice) and STOP: never arm the exponential-backoff loop against a diff that can't land.
        // The desired state stays in memory and the banner clears once a later, smaller diff (the
        // user changing fewer items at once) syncs. Reloading before that discards the unsaved edit.
        // Focus/online recovery also declines this exact snapshot; a fresh edit clears the marker
        // and earns one new attempt in case the resulting delta is now small enough.
        if (serverMode && e instanceof BatchTooLargeError) {
          owner.update({ terminalBatchSnapshot: data });
          cancelRetry();
          return;
        }
        scheduleRetry();
      },
    );
    // Track the round-trip so the switch orchestrator can await it (it never rejects — both arms
    // above settle it). Clear the handle only if it's still THIS round (a newer save may have
    // replaced it mid-flight).
    owner.update({ inFlightSave: round });
    void round.finally(() => {
      if (owner.current.inFlightSave === round) owner.update({ inFlightSave: null });
    });
  };

  // Re-attempt a STRANDED write (one that failed and exhausted its retry budget) when the
  // connection plausibly recovers — the browser fires `online`, or the user returns to the
  // tab. Resets the budget and re-sends the latest store state; the adapter's diff is empty
  // when it's actually already synced, so this is a no-op.
  // Gated on a real prior failure so an idle online/focus event never triggers one.
  const retryStrandedWrite = () => {
    if (owner.current.disposed) return;
    if (!owner.current.failedSinceSuccess) return;
    if (owner.current.suspendDepth > 0) return; // suspended: a replay would race the suspending operation's slice replacement
    const retryData = owner.current.unacknowledged ?? store.getState().data;
    if (owner.current.terminalBatchSnapshot === retryData) return;
    cancelRetry();
    owner.update({ retryAttempts: 0 });
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
    if (owner.current.disposed) return;
    if (owner.current.retryTimer || owner.current.retryAttempts >= MAX_RETRY_ATTEMPTS) return;
    if (owner.current.suspendDepth > 0) return; // suspended: don't re-arm a replay under a slice replacement
    const delay = Math.min(1000 * 2 ** owner.current.retryAttempts, 30000);
    owner.update({ retryAttempts: owner.current.retryAttempts + 1 });
    incrementPersistenceDiagnostic("retriesArmed");
    owner.update({
      retryTimer: setTimeout(() => {
        owner.update({ retryTimer: null });
        if (owner.current.disposed) return;
        if (owner.current.suspendDepth > 0) return;
        save(owner.current.unacknowledged ?? store.getState().data);
      }, delay),
    });
  };

  // Flush the latest UNACKNOWLEDGED write on page teardown via the adapter's `unload` path: it
  // DISPATCHES every op up-front (keepalive), where a normal sequential server drain would
  // only get the first request on the wire before the event loop dies. CONDITIONAL on
  // The snapshot remains tracked until the adapter confirms it, including while an ordinary save
  // is already in flight.
  const flushOnUnload = () => {
    if (owner.current.disposed) return;
    // Under an EXTERNAL suspension (the server-mode import): a parked edit predates a slice
    // replacement that may already be committed server-side — pushing it via keepalive would diff
    // it against the stale pre-import snapshot and upsert ghost rows into the imported slice.
    // Decline; a successful import reload rebases it, while a failed re-hydrate's explicit resume
    // policy owns it. An INTERNAL (reload)
    // suspension deliberately does NOT block this flush: until loadAll resolves the snapshot is
    // still the pre-reload one (and the post-resolve stretch to replaceAll is synchronous — no
    // unload event can interleave), so the keepalive diff is self-vs-self and SAFE — declining
    // would silently lose an edit made during a reload window on every tab close.
    if (owner.current.externalSuspendDepth > 0) {
      if (owner.current.unacknowledged) {
        discardEdit(
          "capacitylens: a parked edit could not be sent during page teardown",
          "An edit was still parked while this company’s data was being replaced during page teardown.",
        );
      }
      return;
    }
    if (owner.current.authoritativeReloadRequiredFor !== null) return;
    cancelDebounce();
    const data = owner.current.unacknowledged;
    if (!data) return;
    // Never consume before confirmation. If pagehide was a bfcache transition and the page survives,
    // success clears this exact snapshot; failure is surfaced and enters the normal retry machinery.
    void adapter.saveAll(data, { unload: true }).then(
      () => {
        if (owner.current.disposed) return;
        acknowledge(data);
      },
      (error: unknown) => {
        if (owner.current.disposed) return;
        owner.update({ failedSinceSuccess: true });
        incrementPersistenceDiagnostic("savesFailed");
        onError?.(error);
        if (beginAuthoritativeReloadFor(error)) return;
        // KNOWN DIVERGENCE (tracked separately): unlike save's rejection handler this arm has no
        // BatchTooLargeError branch, so an over-limit teardown flush still arms the backoff.
        // Preserved as-is here deliberately.
        scheduleRetry();
      },
    );
  };

  // visibilitychange is an ordinary surviving-page event, not teardown. Flush through the normal
  // serialized adapter queue so failures surface/retry and an existing save cannot be overtaken.
  const flushWhileAlive = () => {
    if (owner.current.disposed) return;
    if (owner.current.externalSuspendDepth > 0) return;
    cancelDebounce();
    if (owner.current.unacknowledged) save(owner.current.unacknowledged);
  };

  return { save, scheduleRetry, retryStrandedWrite, flushOnUnload, flushWhileAlive };
}
export type WriteQueue = ReturnType<typeof createWriteQueue>;
