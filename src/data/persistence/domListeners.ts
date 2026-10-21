import type { StoreApi } from "zustand";
import type { StoreState } from "@/store/useStore";
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
    const state = store.getState();
    const id = state.activeAccountId;
    if (id === null) return;
    if (state.activeAccountLoadFailed === id) return;
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

/** Connects lifecycle browser events to persistence flush and refresh handlers. */
export function attachDomListeners({ store, owner, writes, refresh, serverMode }: AttachDomListenersInput) {
  const { retryStrandedWrite, flushOnUnload, flushWhileAlive } = writes;
  // Keepalive teardown and ordinary hidden-tab saves retain an unacknowledged snapshot
  // until confirmation. On return, retry stranded writes before a throttled server refresh
  // so loading cannot overwrite unsaved edits.
  const maybeRefreshActiveSlice = createActiveSliceRefresh({ store, owner, writes, refresh, serverMode });

  const onPageHide = () => flushOnUnload();
  const onVisibility = () => {
    if (typeof document === "undefined") return;
    if (document.visibilityState === "hidden") flushWhileAlive();
    else {
      retryStrandedWrite();
      maybeRefreshActiveSlice();
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
