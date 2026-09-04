import { persistenceCoordinator } from "./coordinator";

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
 *    caller's operation REPLACED the slice server-side, so an edit made against the old basis must
 *    not survive. A successful reload may temporarily rebase that edit for the caller to decide;
 *    dropping restores the retained authoritative slice. Without a successful reload, saving the
 *    stale tree could instead upsert ghost pre-import rows into the replacement.
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

/** Switch the active account through the persistence subscriber and await the exact hydration it
 * owns. A null switch has no slice to load and resolves after the old account's pending write has
 * drained. Authenticated account-transition code must use this seam instead of racing a second
 * refresh against the subscriber. */
export async function switchAndAwaitHydration(id: string | null): Promise<RefreshOutcome> {
  return persistenceCoordinator.switchAndAwaitHydration(id);
}
