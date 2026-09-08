import type { StoreApi } from "zustand";
import type { StoreState } from "../../store/useStore";
import type { AttachmentState } from "./attachmentState";
import type { WriteQueue } from "./writeQueue";
import type { RefreshController } from "./refreshController";

interface AttachDomListenersInput {
  store: StoreApi<StoreState>;
  owner: AttachmentState;
  writes: WriteQueue;
  refresh: RefreshController;
  serverMode: boolean;
}

const REFRESH_MIN_INTERVAL_MS = 30_000;
const VISIBLE_REFRESH_INTERVAL_MS = 60_000;

function createActiveSliceRefresh({ store, owner, refresh, serverMode }: AttachDomListenersInput): () => void {
  const { refreshActive, startAuthoritativeReload } = refresh;
  return () => {
    if (owner.current.disposed || !serverMode) return;
    const id = store.getState().activeAccountId;
    if (id === null) return;
    if (owner.current.authoritativeReloadRequiredFor === id) {
      startAuthoritativeReload(id);
      return;
    }
    const refreshThrottled =
      Date.now() - owner.current.lastRefreshAt <= REFRESH_MIN_INTERVAL_MS &&
      owner.current.pending === null &&
      !owner.current.inFlightSave &&
      !owner.current.failedSinceSuccess;
    if (refreshThrottled || owner.current.focusRefreshInFlight) return;
    owner.update({ focusRefreshInFlight: true });
    void refreshActive(id, { abortIfSaveFailed: true })
      .then((outcome) => {
        if (outcome.kind === "reloaded") owner.update({ lastRefreshAt: Date.now() });
      })
      .finally(() => owner.update({ focusRefreshInFlight: false }));
  };
}

interface DomHandlers {
  pagehide: () => void;
  online: () => void;
  focus: () => void;
  visibilitychange: () => void;
}

function toggleDomListeners(action: "addEventListener" | "removeEventListener", handlers: DomHandlers) {
  window[action]("pagehide", handlers.pagehide);
  window[action]("online", handlers.online);
  window[action]("focus", handlers.focus);
  document[action]("visibilitychange", handlers.visibilitychange);
}

export function attachDomListeners({ store, owner, writes, refresh, serverMode }: AttachDomListenersInput) {
  const { retryStrandedWrite, flushOnUnload, flushWhileAlive } = writes;
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
  const maybeRefreshActiveSlice = createActiveSliceRefresh({ store, owner, writes, refresh, serverMode });

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
  const handlers = { pagehide: onPageHide, online: onOnline, focus: onFocus, visibilitychange: onVisibility };
  if (canListen) toggleDomListeners("addEventListener", handlers);
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
    if (canListen) toggleDomListeners("removeEventListener", handlers);
    if (visibleRefreshTimer) clearInterval(visibleRefreshTimer);
  };
}
