import type { StoreApi } from "zustand";
import type { StoreState } from "../../store/useStore";
import type { AttachmentState } from "./attachmentState";
import type { WriteQueue } from "./writeQueue";
import type { RefreshController } from "./refreshController";

export function attachDomListeners(
  store: StoreApi<StoreState>,
  owner: AttachmentState,
  writes: WriteQueue,
  refresh: RefreshController,
  serverMode: boolean,
) {
  const { retryStrandedWrite, flushOnUnload, flushWhileAlive } = writes;
  const { refreshActive, startAuthoritativeReload } = refresh;
  const REFRESH_MIN_INTERVAL_MS = 30_000;
  const VISIBLE_REFRESH_INTERVAL_MS = 60_000;
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
    if (owner.current.disposed) return;
    if (!serverMode) return;
    const id = store.getState().activeAccountId;
    if (id === null) return; // on the picker — nothing to refresh
    if (owner.current.authoritativeReloadRequiredFor === id) {
      startAuthoritativeReload(id);
      return;
    }
    const now = Date.now();
    // The interval suppresses redundant reads only. A pending/failed write still needs the focus
    // recovery path immediately so it can flush before reloading or retry without waiting 30s.
    if (
      now - owner.current.lastRefreshAt <= REFRESH_MIN_INTERVAL_MS &&
      owner.current.pending === null &&
      !owner.current.inFlightSave &&
      !owner.current.failedSinceSuccess
    )
      return;
    if (owner.current.focusRefreshInFlight) return;
    owner.update({ focusRefreshInFlight: true });
    void refreshActive(id, { abortIfSaveFailed: true })
      .then((outcome) => {
        // Only a real server reload consumes the throttle. Skipped attempts (failed-save guard,
        // superseded owner) remain immediately recoverable on the next focus/online event.
        if (outcome === "reloaded") owner.update({ lastRefreshAt: Date.now() });
      })
      .finally(() => {
        owner.update({ focusRefreshInFlight: false });
      }); // a focus refresh must never clobber failed-save edits
  };

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
    if (canListen) {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    }
    if (visibleRefreshTimer) clearInterval(visibleRefreshTimer);
  };
}
