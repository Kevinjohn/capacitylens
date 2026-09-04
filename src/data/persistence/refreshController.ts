import type { StoreApi } from "zustand";
import type { StoreState } from "../../store/useStore";
import type { PersistenceAdapter } from "../PersistenceAdapter";
import { applyOps, diffOps } from "../syncOps";
import { incrementPersistenceDiagnostic } from "../persistenceDiagnostics";
import type { AttachmentState } from "./attachmentState";
import type { WriteQueue } from "./writeQueue";

export function createRefreshController(
  store: StoreApi<StoreState>,
  adapter: PersistenceAdapter,
  owner: AttachmentState,
  writes: WriteQueue,
  onError?: (e: unknown) => void,
  onSuccess?: () => void,
) {
  const { save } = writes;
  const { cancelRetry, supersededBy, installSlice, discardEdit } = owner;
  const beginSuspension = (external: boolean) => owner.beginSuspension(external, writes);
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
    if (owner.current.disposed || store.getState().activeAccountId !== id) return "skipped";
    // Focus and post-lifecycle refreshes are conveniences, never owners of an account transition.
    // If a switch/refresh already holds an internal slice suspension, starting another abortable refresh
    // would bump its token and could then abort on failedSinceSuccess without issuing a replacement
    // load. The older load would have re-seeded the adapter but be forbidden to install its slice,
    // leaving one tenant's data paired with another tenant's diff snapshot. An external import
    // suspension is excluded: its owner deliberately invokes this refresh to reseed after import.
    if (abortIfSaveFailed && owner.current.suspendDepth > owner.current.externalSuspendDepth) return "skipped";
    const myToken = owner.nextSwitchToken();
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
      if (owner.current.inFlightSave) await owner.current.inFlightSave;
      if (supersededBy(myToken)) return "skipped"; // detached/newer owner owns effects
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
      if (owner.current.pending && owner.current.externalSuspendDepth === 0) {
        save(owner.current.pending); // sets inFlightSave synchronously; pending is consumed inside save()
        if (owner.current.inFlightSave) await owner.current.inFlightSave;
        if (supersededBy(myToken)) return "skipped"; // detached/newer owner owns effects
      }
      // See the abortIfSaveFailed doc above: a refresh must not reload over a failed save's edits.
      // Checked AFTER the flush/await so a flush that just SUCCEEDED (clearing the flag) still refreshes.
      if (abortIfSaveFailed && owner.current.failedSinceSuccess) return "skipped";
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
      const failedBeforeLoad = owner.current.failedSinceSuccess;
      const slice = await adapter.loadAll(id);
      if (owner.current.disposed) return "skipped";
      if (myToken !== owner.current.switchToken) {
        incrementPersistenceDiagnostic("reloadsSuperseded");
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
          if (currentData !== dataAtLoad || owner.current.pending !== null) {
            installed = applyOps(slice, diffOps(dataAtSequenceStart, currentData));
            incrementPersistenceDiagnostic("editsRebased");
            owner.update({ pending: null });
            owner.update({ unacknowledged: installed });
            save(installed);
            if (owner.current.inFlightSave) await owner.current.inFlightSave;
          }
          installSlice(installed);
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
      const editedMidLoad = currentData !== dataAtLoad || owner.current.pending !== null;
      const lostFailedEdits = failedBeforeLoad && !owner.current.resolvingAuthoritativeReload;
      let installed = slice;
      if (owner.current.externalSuspendDepth > 0) owner.update({ externalAuthoritativeData: slice });
      if (editedMidLoad) {
        // Rebase only the operations the user performed during this network window onto the fresh
        // server slice. This preserves remote additions and lifecycle/import changes while keeping
        // the user's concurrent edit. The adapter was seeded to `slice`; parking `installed` lets
        // the suspension owner either save that rebased state normally or deliberately drop it and
        // restore `slice`.
        const editBase =
          owner.current.externalSuspendDepth > 0 && owner.current.externalBaseData
            ? owner.current.externalBaseData
            : dataAtSequenceStart;
        installed = applyOps(slice, diffOps(editBase, currentData));
        incrementPersistenceDiagnostic("editsRebased");
        owner.update({ pending: installed });
        owner.update({ unacknowledged: installed });
      } else if (lostFailedEdits) {
        owner.update({ pending: null });
        owner.update({ unacknowledged: null });
      }
      // A successfully rebased mid-load edit and an older discarded failed write are independent
      // outcomes. Preserve the former above, but always surface the latter before clearing the
      // transient transport-failure state below.
      if (lostFailedEdits) {
        discardEdit(
          "capacitylens: an unsaved edit was discarded during an authoritative reload",
          "An edit could not be saved before this company’s data reloaded.",
        );
      }
      // Swap `data` to the loaded slice WITHOUT it reading as a user edit, then advance lastData.
      installSlice(installed);
      if (!editedMidLoad) owner.update({ unacknowledged: null });
      owner.update({ authoritativeReloadRequiredFor: null });
      // The store now holds the server's authoritative slice and the snapshot is re-seeded to it —
      // writes are CLEAN by construction, whatever their history. Clear the failure state and fire
      // onSuccess (mirrors the 409 arm's follow-up empty save, which exists for the same reason):
      //  - a prior tenant's exhausted-retry failure must not leak into this tenant (it would block
      //    an import here via flushPendingWrites and suppress focus refreshes via abortIfSaveFailed);
      //  - a rebase is followed by a normal save when suspension resumes; this success marks the
      //    transport healthy without discarding either local or remote changes.
      // Any loss this clearing could have hidden was surfaced by the (c) check above.
      owner.update({ failedSinceSuccess: false });
      owner.update({ retryAttempts: 0 });
      cancelRetry();
      onSuccess?.();
      return "reloaded";
    } catch (e) {
      // A failed slice load surfaces like any load failure: raise the persist banner (a stale
      // banner clears on the next good write). Don't replaceAll — leaving the prior data is
      // safer than blanking it, and the snapshot is unchanged so no bad diff can form. An edit
      // parked during the failed load is re-scheduled by the finally-resume below.
      if (owner.current.disposed || myToken !== owner.current.switchToken) return "skipped"; // detached/newer owner owns outcome
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
    if (owner.current.disposed || owner.current.resolvingAuthoritativeReload) return;
    owner.update({ resolvingAuthoritativeReload: true });
    void refreshActive(activeId)
      .then((outcome) => {
        if (owner.current.disposed || outcome !== "reloaded") return;
        incrementPersistenceDiagnostic("reconciliationsResolved");
        // One follow-up save makes an empty diff acknowledge recovery, or lands only edits made
        // during the reload after refreshActive rebased them onto the authoritative slice.
        if (store.getState().activeAccountId !== activeId) return;
        if (owner.current.inFlightSave) return owner.current.inFlightSave;
        save(store.getState().data);
        return owner.current.inFlightSave ?? undefined;
      })
      .finally(() => {
        owner.update({ resolvingAuthoritativeReload: false });
      });
  }

  return { refreshActive, startAuthoritativeReload, beginSuspension };
}
export type RefreshController = ReturnType<typeof createRefreshController>;
