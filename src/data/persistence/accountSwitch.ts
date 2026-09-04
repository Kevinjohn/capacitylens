import type { StoreApi } from "zustand";
import type { StoreState } from "../../store/useStore";
import type { AttachmentState } from "./attachmentState";
import type { WriteQueue } from "./writeQueue";
import type { RefreshController } from "./refreshController";
import type { RefreshOutcome } from "./facades";

export function attachAccountSwitch(
  store: StoreApi<StoreState>,
  owner: AttachmentState,
  writes: WriteQueue,
  refresh: RefreshController,
  serverMode: boolean,
) {
  const { save } = writes;
  const { refreshActive } = refresh;
  const { cancelDebounce } = owner;
  const settleSwitch = (id: string | null, outcome: RefreshOutcome) => {
    for (let index = owner.current.switchWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = owner.current.switchWaiters[index]!;
      if (waiter.id !== id) continue;
      owner.current.switchWaiters.splice(index, 1);
      waiter.resolve(outcome);
    }
  };

  const unsubscribeSwitch = serverMode
    ? store.subscribe((state) => {
        const newId = state.activeAccountId;
        if (newId === owner.current.lastActiveAccountId) return;
        owner.update({ lastActiveAccountId: newId });
        // Null (dropped to the picker / sign-out) loads nothing — the picker shows accountSummaries,
        // and the next non-null pick will hydrate. Cancel any in-flight switch so its late load can't
        // seed. Still FLUSH the OLD account's pending debounced edits first (same data-loss edge as a
        // real A→B switch): data and the snapshot are both still account A here, so the flush diffs
        // A-vs-A correctly. No loadAll follows, so there's no later snapshot reseed to race.
        if (newId === null) {
          const myToken = owner.nextSwitchToken();
          void (async () => {
            if (owner.current.inFlightSave) await owner.current.inFlightSave;
            if (owner.current.disposed || myToken !== owner.current.switchToken) return; // detached/newer owner owns effects
            cancelDebounce();
            // A parked edit belongs to whichever slice replacement still holds the suspension.
            // A token bump supersedes an internal refresh's outcome, not its outstanding load or
            // suspension; that refresh rebases and saves the edit when it settles.
            if (owner.current.pending && owner.current.suspendDepth === 0) {
              save(owner.current.pending);
              if (owner.current.inFlightSave) await owner.current.inFlightSave;
            }
            settleSwitch(null, "reloaded");
          })();
          return;
        }
        void refreshActive(newId).then((outcome) => {
          // A successful company switch just loaded this same slice. Count it as a refresh so a
          // focus event delivered by the picker transition cannot immediately load it again.
          if (outcome === "reloaded") owner.update({ lastRefreshAt: Date.now() });
          settleSwitch(newId, outcome);
        });
      })
    : null;

  const myRegisteredSwitch = serverMode
    ? (id: string | null) =>
        new Promise<RefreshOutcome>((resolve) => {
          const previousId = store.getState().activeAccountId;
          if (previousId === id) {
            resolve("skipped");
            return;
          }
          owner.current.switchWaiters.push({ id, resolve });
          store.getState().setActiveAccount(id);
          if (store.getState().activeAccountId !== id) settleSwitch(id, "skipped");
        })
    : null;

  return { unsubscribeSwitch, myRegisteredSwitch };
}
