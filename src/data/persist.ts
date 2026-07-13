import type { StoreApi } from 'zustand'
import { emptyAppData, isEmpty } from '@capacitylens/shared/types/entities'
import type { AppData } from '@capacitylens/shared/types/entities'
import type { StoreState } from '../store/useStore'
import { LoadError, type PersistenceAdapter } from './PersistenceAdapter'
import { BatchConflictError } from './ServerSyncAdapter'
import { applyOps, diffOps } from './syncOps'

// Persistence is wired OUTSIDE the store so the store stays a pure state
// container (and is trivially testable). attachPersistence debounce-saves on
// every data change; bootstrap loads (and seeds only on a genuine first run).

// The attached orchestrator's refreshActive, registered (server mode only) so OUT-OF-BAND server
// writers — the lifecycle hook's archive/delete/purge routes — can reuse the exact
// flush-pending → await-in-flight → token-guarded reload sequence instead of hand-rolling
// loadAll+replaceAll, which would silently replace a still-debounced edit AND re-seed the adapter
// snapshot under it (the retry then diffs to zero ops — permanent data loss). Null when no
// orchestrator is attached (demo build, unit tests).
let registeredRefreshActive: ((id: string) => Promise<'reloaded' | 'skipped' | 'failed'>) | null = null

// The orchestrator's flush-pending seam (server mode only), registered alongside refreshActive so
// an out-of-band writer that is about to make the local state OBSOLETE (the server-mode import —
// an atomic whole-slice replacement) can first land any still-debounced edits against the
// PRE-replacement state, in order, instead of having the post-replacement reload's own entry
// flush push pre-replacement rows into the freshly imported slice.
let registeredFlushPending: (() => Promise<boolean>) | null = null

// The orchestrator's write-suspension seam (server mode only). While suspended, edits are PARKED
// (recorded in `pending`, never sent): an out-of-band whole-slice replacement (the server-mode
// import) uses it so an edit made while the import POST is in flight can neither land just before
// the import (and be silently wiped by it) nor be flushed by the post-import reload's entry
// sequence against the PRE-import snapshot (which would upsert stale rows into the freshly
// imported slice — the import remaps ids, so the stale row inserts cleanly, no 409). A parked
// edit is rebased onto a successfully reloaded slice, re-scheduled when the operation failed before
// touching the slice, or dropped + surfaced by resume itself only when the
// caller reports the slice WAS replaced but no reload reseeded the snapshot (dropParkedEdits).
// refreshActive also suspends around its own whole sequence for the same reasons.
let registeredSuspendWrites: (() => (opts?: { dropParkedEdits?: boolean }) => void) | null = null

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
  if (!registeredSuspendWrites) return () => {}
  return registeredSuspendWrites()
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
export type RefreshOutcome = 'reloaded' | 'skipped' | 'failed' | 'unattached'

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
  if (!registeredFlushPending) return true
  return registeredFlushPending()
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
    super(message)
    this.name = 'ReloadDiscardedEditError'
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
  if (!registeredRefreshActive) return 'unattached'
  return registeredRefreshActive(id)
}

/**
 * Wire the store to a PersistenceAdapter (OUTSIDE the store) and return an unsubscribe.
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
 *  5. On page teardown (`pagehide` / `visibilitychange→hidden`) a PENDING debounced write is
 *     flushed through the adapter's keepalive `unload` path.
 */
export function attachPersistence(
  store: StoreApi<StoreState>,
  adapter: PersistenceAdapter,
  debounceMs = 300,
  onError?: (e: unknown) => void,
  onSuccess?: () => void,
  serverMode = false,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastData = store.getState().data
  let pending: AppData | null = null // data awaiting a debounced write
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let retryAttempts = 0
  let failedSinceSuccess = false // a write failed and hasn't recovered — gates the online/visible re-attempt
  // True while a 409 batch conflict is being resolved by a server-wins reload (see save's rejection
  // arm). Guards re-entry: the resolution reload's own entry flush can 409 AGAIN if OTHER pending
  // edits are also stale — without this a nested conflict would recurse into a reload↔save loop.
  let resolvingConflict = false
  // The currently-running save round-trip (P1.13): the account-switch orchestrator AWAITS it so a
  // prior account's save can't land against the new account's snapshot. Resolved (never rejected) so
  // an in-flight FAILED save can still be awaited; settles whether the save succeeds or fails.
  let inFlightSave: Promise<void> | null = null
  const MAX_RETRY_ATTEMPTS = 5
  // > 0 while writes are SUSPENDED (see suspendServerWrites and refreshActive): edits are parked
  // in `pending` with no timer and retries hold off. A depth, not a boolean, because an external
  // suspension (the server-mode import) and refreshActive's own suspension can overlap — and two
  // refreshActive calls can overlap each other (a switch superseding a focus refresh).
  let suspendDepth = 0
  // The EXTERNAL subset of suspendDepth (the import seam only). Tracked separately because the
  // two kinds differ in what a keepalive unload flush may do: under an INTERNAL (reload)
  // suspension the diff snapshot is still the pre-reload one until loadAll resolves (and the
  // post-resolve stretch to replaceAll is synchronous — no unload event can interleave), so
  // flushing a parked edit on teardown diffs self-vs-self and is SAFE; under an external
  // suspension the import POST may already have replaced the slice server-side, so the same
  // flush would upsert stale pre-import rows.
  let externalSuspendDepth = 0
  let externalBaseData: AppData | null = null

  // The debounce/retry cancel idioms, used from many seams — one helper each so a future change
  // to their bookkeeping can't miss a copy (an uncancelled timer firing post-reseed with
  // pre-reload data is exactly the bug class this file exists to prevent).
  const cancelDebounce = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }
  const cancelRetry = () => {
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
  }
  // Refresh-on-focus throttle (P1.16): coming back to the tab re-hydrates the active account's
  // slice, but a user flipping between tabs would otherwise refetch on every focus. Cap the cadence
  // to once per 30s; the timestamp is taken at refresh START so two focus events inside the window
  // collapse to a single loadAll.
  const REFRESH_MIN_INTERVAL_MS = 30_000
  let lastRefreshAt = 0

  const save = (data: AppData) => {
    pending = null
    // Two-arg then so a throw inside onSuccess isn't misreported as a save error.
    // onSuccess lets the caller CLEAR a prior error state once a write lands again
    // — essential for the server adapter, where a transient network blip sets the
    // banner but the next successful sync should take it back down (and harmless
    // for localStorage, where quota can free up between writes).
    const round = adapter.saveAll(data).then(
      () => {
        retryAttempts = 0
        failedSinceSuccess = false
        cancelRetry()
        onSuccess?.()
      },
      (e: unknown) => {
        failedSinceSuccess = true
        // The banner must surface EVERY failed write — including a conflict, where the user's
        // edit is about to be discarded (server wins below); they must learn it did not save.
        onError?.(e)
        // A 409 batch conflict (optimistic-concurrency servers) is NOT transient: the same stale
        // diff 409s forever, so the backoff retry + the stranded-write re-arms (focus/online)
        // would loop the error endlessly — and abortIfSaveFailed blocks the focus refresh that
        // could break the loop. There is no client conflict UI yet, so apply the documented
        // interim policy — SERVER WINS: reload the active slice instead of retrying. The reload
        // deliberately does NOT pass abortIfSaveFailed: this reload IS the resolution, and the
        // local conflicting edit is knowingly discarded. A future conflict UI replaces this arm.
        if (serverMode && e instanceof BatchConflictError) {
          // Never re-arm the backoff with a stale diff — it would just replay into another 409.
          cancelRetry()
          const activeId = store.getState().activeAccountId
          // Nested conflict during the resolution (resolvingConflict), or no active account to
          // reload: just surface the banner and stop. The completed reload reseeds the snapshot,
          // so the next save diffs clean; a focus/online re-attempt retriggers resolution if needed.
          if (activeId !== null && !resolvingConflict) {
            // Server-wins is an explicit abandonment decision. Remove only this account's durable
            // journal entry before reloading; transport failures retain theirs for next-session replay.
            try {
              adapter.discardPending?.(activeId)
            } catch (discardError) {
              onError?.(discardError)
              return
            }
            resolvingConflict = true
            void refreshActive(activeId)
              .then(() => {
                // One follow-up save so a now-empty diff fires onSuccess and clears the banner
                // (the reload installed the server slice, so slice-vs-slice diffs to zero; an
                // edits made DURING the reload are rebased without restoring this original
                // conflicted edit). NOTE the banner-clearing onSuccess does
                // not retract the sticky conflict notice raised via onError — that toast stays
                // until the user dismisses it (they must learn their conflicting edit was
                // discarded). Skipped if the user switched tenants mid-resolution — the switch
                // orchestrator owns the new slice's lifecycle. resolvingConflict stays up until
                // this follow-up settles, so a follow-up 409 cannot recurse into another reload.
                if (store.getState().activeAccountId !== activeId) return
                save(store.getState().data)
                return inFlightSave ?? undefined
              })
              .finally(() => {
                resolvingConflict = false
              })
          }
          return
        }
        scheduleRetry()
      },
    )
    // Track the round-trip so the switch orchestrator can await it (it never rejects — both arms
    // above settle it). Clear the handle only if it's still THIS round (a newer save may have
    // replaced it mid-flight).
    inFlightSave = round
    void round.finally(() => {
      if (inFlightSave === round) inFlightSave = null
    })
  }

  // Re-attempt a STRANDED write (one that failed and exhausted its retry budget) when the
  // connection plausibly recovers — the browser fires `online`, or the user returns to the
  // tab. Resets the budget and re-sends the latest store state; the adapter's diff is empty
  // when it's actually already synced, so this is a no-op (and avoids a needless full re-write
  // — important for the localStorage adapter, which rewrites the whole blob every save).
  // Gated on a real prior failure so an idle online/focus event never triggers one.
  const retryStrandedWrite = () => {
    if (!failedSinceSuccess) return
    if (suspendDepth > 0) return // suspended: a replay would race the suspending operation's slice replacement
    cancelRetry()
    retryAttempts = 0
    save(store.getState().data)
  }

  // A failed write (e.g. the server is briefly unreachable) is retried in the
  // background with exponential backoff, re-sending the LATEST store state, so a
  // transient failure self-heals WITHOUT waiting for the user's next edit. Without
  // this, a reload after the server recovered but before the next edit would lose the
  // unsynced changes (server-backed mode has no localStorage fallback). Capped so a
  // permanently-rejected write doesn't retry forever; a fresh user edit (see the
  // subscribe handler) resets the budget.
  const scheduleRetry = () => {
    if (retryTimer || retryAttempts >= MAX_RETRY_ATTEMPTS) return
    if (suspendDepth > 0) return // suspended: don't re-arm a replay under a slice replacement
    const delay = Math.min(1000 * 2 ** retryAttempts, 30000)
    retryAttempts += 1
    retryTimer = setTimeout(() => {
      retryTimer = null
      save(store.getState().data)
    }, delay)
  }

  // Flush a PENDING debounced write on page teardown via the adapter's `unload` path: it
  // DISPATCHES every op up-front (keepalive), where a normal sequential server drain would
  // only get the first request on the wire before the event loop dies. CONDITIONAL on
  // `pending`: once the debounce has settled there's nothing to flush, so we never re-write
  // already-persisted data (an unconditional write would, e.g., resurrect it after an
  // external storage clear, and is wasteful besides).
  const flushOnUnload = () => {
    // Under an EXTERNAL suspension (the server-mode import): a parked `pending` predates a slice
    // replacement that may already be committed server-side — pushing it via keepalive would diff
    // it against the stale pre-import snapshot and upsert ghost rows into the imported slice.
    // Decline; a successful import reload rebases it, while a failed re-hydrate's explicit resume
    // policy owns it. An INTERNAL (reload)
    // suspension deliberately does NOT block this flush: until loadAll resolves the snapshot is
    // still the pre-reload one (and the post-resolve stretch to replaceAll is synchronous — no
    // unload event can interleave), so the keepalive diff is self-vs-self and SAFE — declining
    // would silently lose an edit made during a reload window on every tab close. The cost when
    // the page merely HIDES (not closes) mid-reload: the flushed edit lands server-side, the
    // reload then rebases it and confirms it through the ordinary save path.
    if (externalSuspendDepth > 0) return
    cancelDebounce()
    if (!pending) return
    const data = pending
    // Under an INTERNAL suspension, dispatch WITHOUT consuming: the reload's (c) check and the
    // finally-resume still own the parked edit's fate. Consuming it here made a FAILED keepalive
    // invisible — the page survived (tab merely hidden, not closed), `pending` was gone before
    // dataAtLoad was snapshotted, and the edit vanished with zero surface. Leaving it parked
    // costs at most a duplicate dispatch (PUT upserts are idempotent) plus the documented
    // duplicate confirmed save when the keepalive DID land.
    if (suspendDepth === 0) pending = null
    void adapter.saveAll(data, { unload: true }).catch(() => {})
  }

  // Set by the account-switch orchestrator (below) around its replaceAll(newSlice) so the data
  // subscription treats the slice LOAD as a tenant change, NOT a user edit — without it the loaded
  // slice would be diffed against the OLD account's snapshot and pushed back as a spurious (and, in
  // server mode, CROSS-ACCOUNT) save. The orchestrator advances lastData itself in lockstep.
  let loadingSlice = false

  const unsubscribe = store.subscribe((state) => {
    if (state.data === lastData) return // only persist when data actually changes
    lastData = state.data
    // The orchestrator's slice load is not a user edit — track lastData (done) but DON'T save it.
    if (loadingSlice) return
    // Suspended (a slice replacement is in flight): PARK the edit — record it in `pending` with no
    // timer so nothing sends it. It is rebased by a successful reload, or re-scheduled on resume
    // when the suspending operation failed before any reload.
    if (suspendDepth > 0) {
      pending = state.data
      return
    }
    retryAttempts = 0 // a fresh user change earns a fresh retry budget
    if (debounceMs <= 0) {
      save(state.data)
      return
    }
    pending = state.data
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => save(state.data), debounceMs)
  })

  // Demo/local mode: adopt another tab's whole-tree write only while this tab is clean. The
  // adapter's compare-and-swap revision independently rejects a racing save; this listener keeps
  // an idle tab current instead of letting two full snapshots silently overwrite each other.
  const unsubscribeExternal = adapter.subscribeExternal?.((data) => {
    if (pending || inFlightSave || failedSinceSuccess || suspendDepth > 0) {
      onError?.(new Error('Data changed in another tab while this tab had unsaved changes. Reload to reconcile.'))
      return false
    }
    loadingSlice = true
    store.getState().replaceAll(data)
    lastData = store.getState().data
    loadingSlice = false
    return true
  })

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
  let switchToken = 0
  let lastActiveAccountId = store.getState().activeAccountId

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
    suspendDepth += 1
    if (external) {
      if (externalSuspendDepth === 0) externalBaseData = store.getState().data
      externalSuspendDepth += 1
    }
    cancelDebounce()
    let resumed = false
    return (opts = {}) => {
      if (resumed) return // resume is idempotent — a double call must not underflow the depth
      resumed = true
      suspendDepth -= 1
      if (external) {
        externalSuspendDepth -= 1
        if (externalSuspendDepth === 0 && !pending) externalBaseData = null
      }
      if (suspendDepth > 0 || !pending) return
      if (opts.dropParkedEdits) {
        pending = null
        onError?.(
          new ReloadDiscardedEditError(
            'An edit arrived while this company’s data was being replaced and could not be saved.',
          ),
        )
      } else {
        const parked = pending
        if (external) externalBaseData = null
        save(parked)
      }
    }
  }

  const refreshActive = async (
    id: string,
    opts: { abortIfSaveFailed?: boolean } = {},
  ): Promise<'reloaded' | 'skipped' | 'failed'> => {
    const { abortIfSaveFailed = false } = opts
    // ENTRY GUARD — before the token bump. An out-of-band caller with a STALE id (the lifecycle
    // hook's post-mutation reload resolving after the user switched tenant A→B) must neither
    // reload the wrong tenant NOR cancel a newer switch's in-flight slice load — bumping
    // switchToken here would do exactly that: B's late-resolving loadAll hits `myToken !==
    // switchToken` and is discarded while A's stale slice is installed under B's active id
    // (cross-tenant display, then cross-tenant writes). The switch subscriber calls refreshActive
    // AFTER setActiveAccount has already set the id, so this guard passes for every real switch;
    // mid-flight supersession is still covered by the post-await token checks below.
    if (store.getState().activeAccountId !== id) return 'skipped'
    const myToken = ++switchToken
    // The ENTIRE sequence runs under a write suspension — not just loadAll. An edit landing during
    // ANY await below is parked: it is included in the (a′) flush when it arrives before it (the
    // parked tree is the whole store snapshot, so the flush carries it — safe pre-reseed), and
    // rebased at (c) when it arrives after. Without whole-sequence coverage, an edit
    // arriving during the (a)/(a′) awaits re-armed a debounce timer at depth 0 that fired MID-LOAD:
    // its save was silently discarded by the adapter's seedGen guard, the (c) check couldn't see it
    // (pending consumed, dataAtLoad snapshotted later), and the edit vanished with no surface.
    // The finally-resume also re-schedules an edit left parked by a FAILED load (slice + snapshot
    // unchanged → saving is correct; leaving it parked with no timer would strand it until the
    // next edit or reload, losing it to any tab close in between).
    const dataAtSequenceStart = store.getState().data
    const resume = beginSuspension(false)
    try {
      // (a) Let a prior account's save settle before we re-seed the snapshot.
      if (inFlightSave) await inFlightSave
      if (myToken !== switchToken) return 'skipped' // a newer switch/refresh superseded this one
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
        save(pending) // sets inFlightSave synchronously; pending is consumed inside save()
        if (inFlightSave) await inFlightSave
        if (myToken !== switchToken) return 'skipped' // a newer switch/refresh superseded this one mid-flush
      }
      // See the abortIfSaveFailed doc above: a refresh must not reload over a failed save's edits.
      // Checked AFTER the flush/await so a flush that just SUCCEEDED (clearing the flag) still refreshes.
      if (abortIfSaveFailed && failedSinceSuccess) return 'skipped'
      // A pre-armed backoff retry must not survive into the load: it would fire mid-load, its
      // stale save silently discarded by the seedGen guard while the success arm below cleared
      // the failure state — hiding the loss. Cancel it; the loss it carried is surfaced at (c).
      cancelRetry()
      // Snapshot the store state the reload starts from, so an edit landing DURING loadAll is
      // detectable below — a bare `pending` check alone can't see it (an immediate-mode save nulls
      // pending while the edit's data is already in the store).
      const dataAtLoad = store.getState().data
      // (b) Load the slice; loadAll(id) re-seeds the adapter's diff snapshot to it. Writes stay
      // suspended so an edit arriving mid-load is parked and can be rebased after the response,
      // never raced onto the server against the old snapshot.
      const slice = await adapter.loadAll(id)
      if (myToken !== switchToken) {
        // Superseded AFTER loadAll resolved: the load has already RESEEDED the adapter's diff
        // snapshot, and the superseding token bump may install nothing over it (the null-switch /
        // A newer refresh owns any parked edit. A sign-out, however, starts no replacement load:
        // preserve only the operations made during this window by rebasing them onto the slice
        // that just seeded the adapter, then persist that account without reinstalling it in the
        // signed-out UI. This avoids both loss and a stale whole-tree overwrite of remote rows.
        if (store.getState().activeAccountId === null) {
          const currentData = store.getState().data
          if (currentData !== dataAtLoad || pending !== null) {
            const rebased = applyOps(slice, diffOps(dataAtSequenceStart, currentData))
            pending = null
            save(rebased)
            if (inFlightSave) await inFlightSave
          }
        }
        return 'skipped' // superseded mid-load — discard this stale slice
      }
      // (c) Mid-load edit check — see the rebase-policy doc above the function. Three signals count:
      // a changed data reference (the edit is in the store, saved or not), a non-null `pending`
      // (a parked edit), or failedSinceSuccess (a switch/conflict path proceeded past a FAILED
      // (a′) flush — those un-persisted edits are about to be discarded by the replaceAll below,
      // and the success arm then clears the banner that was their only surface; the sticky notice
      // raised here replaces it). The conflict-resolution reload is exempt from the third signal:
      // its 409 arm already raised the dedicated sticky conflict notice for the same loss.
      const currentData = store.getState().data
      const editedMidLoad = currentData !== dataAtLoad || pending !== null
      const lostFailedEdits = failedSinceSuccess && !resolvingConflict
      let installed = slice
      if (editedMidLoad) {
        // Rebase only the operations the user performed during this network window onto the fresh
        // server slice. This preserves remote additions and lifecycle/import changes while keeping
        // the user's concurrent edit. The adapter was seeded to `slice`; parking `installed` makes
        // the resumed save diff and commit this rebased state normally (and durably).
        const editBase = externalSuspendDepth > 0 && externalBaseData ? externalBaseData : dataAtSequenceStart
        installed = applyOps(slice, diffOps(editBase, currentData))
        pending = installed
      } else if (lostFailedEdits) {
        pending = null
        onError?.(
          new ReloadDiscardedEditError(
            'An edit could not be saved before this company’s data reloaded.',
          ),
        )
      }
      // Swap `data` to the loaded slice WITHOUT it reading as a user edit, then advance lastData.
      loadingSlice = true
      store.getState().replaceAll(installed)
      lastData = store.getState().data
      loadingSlice = false
      // The store now holds the server's authoritative slice and the snapshot is re-seeded to it —
      // writes are CLEAN by construction, whatever their history. Clear the failure state and fire
      // onSuccess (mirrors the 409 arm's follow-up empty save, which exists for the same reason):
      //  - a prior tenant's exhausted-retry failure must not leak into this tenant (it would block
      //    an import here via flushPendingWrites and suppress focus refreshes via abortIfSaveFailed);
      //  - a rebase is followed by a normal save when suspension resumes; this success marks the
      //    transport healthy without discarding either local or remote changes.
      // Any loss this clearing could have hidden was surfaced by the (c) check above.
      failedSinceSuccess = false
      retryAttempts = 0
      cancelRetry()
      onSuccess?.()
      return 'reloaded'
    } catch (e) {
      // A durable next-session replay can itself meet a newer server revision. Apply the same
      // explicit server-wins policy as an ordinary save conflict: surface the sticky conflict,
      // abandon only this account's journal entry, and immediately retry the read so the UI does
      // not get stuck behind the same 409 on every reload.
      if (
        e instanceof BatchConflictError &&
        myToken === switchToken &&
        store.getState().activeAccountId === id
      ) {
        try {
          adapter.discardPending?.(id)
        } catch (discardError) {
          onError?.(discardError)
          return 'failed'
        }
        onError?.(e)
        return refreshActive(id, opts)
      }
      // A failed slice load surfaces like any load failure: raise the persist banner (a stale
      // banner clears on the next good write). Don't replaceAll — leaving the prior data is
      // safer than blanking it, and the snapshot is unchanged so no bad diff can form. An edit
      // parked during the failed load is re-scheduled by the finally-resume below.
      if (myToken !== switchToken) return 'skipped' // superseded — a newer call owns the outcome
      onError?.(e)
      return 'failed'
    } finally {
      resume()
    }
  }

  const unsubscribeSwitch = serverMode
    ? store.subscribe((state) => {
        const newId = state.activeAccountId
        if (newId === lastActiveAccountId) return
        lastActiveAccountId = newId
        // Null (dropped to the picker / sign-out) loads nothing — the picker shows accountSummaries,
        // and the next non-null pick will hydrate. Cancel any in-flight switch so its late load can't
        // seed. Still FLUSH the OLD account's pending debounced edits first (same data-loss edge as a
        // real A→B switch): data and the snapshot are both still account A here, so the flush diffs
        // A-vs-A correctly. No loadAll follows, so there's no later snapshot reseed to race.
        if (newId === null) {
          const myToken = ++switchToken
          void (async () => {
            if (inFlightSave) await inFlightSave
            if (myToken !== switchToken) return // a newer switch superseded this one
            cancelDebounce()
            // Same external-suspension rule as refreshActive's (a′): a parked edit belongs to the
            // suspending slice replacement's drop/resume, not to this flush. (An INTERNAL
            // suspension can't hold here — this token bump superseded any in-flight refresh, and
            // its resume defers to whoever holds the depth; a pre-reseed flush stays safe anyway.)
            if (pending && externalSuspendDepth === 0) {
              save(pending)
              if (inFlightSave) await inFlightSave
            }
          })()
          return
        }
        void refreshActive(newId)
      })
    : null

  // The debounce window can outlive the tab. `pagehide` is the reliable close/navigate signal
  // (fires for the bfcache case where `beforeunload` doesn't); `visibilitychange → hidden`
  // covers tab switches and mobile. Both route through flushOnUnload (dispatch-all). On a real
  // close, visibilitychange → hidden fires FIRST — while the page is still alive to dispatch —
  // so it does the flush and the subsequent pagehide is a no-op (`pending` already consumed).
  // Coming BACK to the tab (or the browser firing `online`) re-attempts a stranded write.
  // Refresh-on-focus (P1.16): when the user returns to the tab/window, re-hydrate the active
  // account's slice so a change made in another tab/device shows up — REUSING refreshActive (the
  // switch orchestrator's body) so the private lastSynced snapshot is re-seeded atomically and stays
  // consistent with `data` (a parallel re-hydrate would desync them and emit a garbage diff). Guards:
  // SERVER mode only (refreshActive only re-seeds meaningfully when serverMode; local already holds
  // every account); SKIP when there's no active account (on the picker — nothing to refresh); and
  // THROTTLE to REFRESH_MIN_INTERVAL_MS. Unsaved-edit safety is INHERENT — refreshActive flushes
  // pending + awaits inFlightSave BEFORE loadAll, so the user's edits POST first (last-writer-wins).
  const maybeRefreshOnFocus = () => {
    if (!serverMode) return
    const id = store.getState().activeAccountId
    if (id === null) return // on the picker — nothing to refresh
    const now = Date.now()
    if (now - lastRefreshAt <= REFRESH_MIN_INTERVAL_MS) return
    lastRefreshAt = now // stamp at refresh START so two focuses inside the window collapse to one
    void refreshActive(id, { abortIfSaveFailed: true }) // a focus refresh must never clobber failed-save edits
  }

  // Register the orchestrator-backed refresh for out-of-band server writers (see
  // refreshActiveAccountSlice above). Server mode only — the demo build's lifecycle actions mutate
  // the store directly and never reload. abortIfSaveFailed for the same reason as focus-refresh:
  // a post-lifecycle reload is a convenience re-hydrate, never worth destroying un-persisted edits.
  const myRegisteredRefresh = serverMode ? (id: string) => refreshActive(id, { abortIfSaveFailed: true }) : null
  if (myRegisteredRefresh) registeredRefreshActive = myRegisteredRefresh

  // Flush-pending seam for out-of-band whole-slice writers (the server-mode import): land any
  // still-debounced edit against the CURRENT state, in order, and report whether writes are clean.
  // Returning false (a write is still failed) tells the caller its precondition — "local edits are
  // persisted or knowingly abandoned" — does not hold; the import path refuses to proceed rather
  // than let its post-import reload wipe an unsaved edit or its retry replay a stale diff over the
  // freshly imported slice.
  const myRegisteredFlush = serverMode
    ? async (): Promise<boolean> => {
        // Suspended: another slice replacement is already in flight — writes are NOT clean and
        // flushing the parked edit would push it against a mid-replacement snapshot. Refuse.
        if (suspendDepth > 0) return false
        // Loop until QUIESCENT, not just one round: writes are unsuspended during the await, so
        // an edit landing mid-flush arms a fresh debounce whose save can outlive a single await —
        // a one-shot flush would then return "clean" while that save is still on the wire, and
        // the caller's import POST would race it (the exact pre-suspension window the whole
        // import sequence exists to close). Terminates when a full round finds nothing new.
        while (timer || pending || inFlightSave) {
          cancelDebounce()
          if (pending) save(pending) // consumes pending, sets inFlightSave synchronously
          if (inFlightSave) await inFlightSave
        }
        return !failedSinceSuccess
      }
    : null
  if (myRegisteredFlush) registeredFlushPending = myRegisteredFlush

  // Write-suspension seam (see suspendServerWrites' doc for the resume contract) — the EXTERNAL
  // variant of beginSuspension, registered for the server-mode import.
  const myRegisteredSuspend = serverMode ? () => beginSuspension(true) : null
  if (myRegisteredSuspend) registeredSuspendWrites = myRegisteredSuspend

  const onPageHide = () => flushOnUnload()
  const onVisibility = () => {
    if (typeof document === 'undefined') return
    if (document.visibilityState === 'hidden') flushOnUnload()
    else {
      retryStrandedWrite()
      maybeRefreshOnFocus() // returning via tab-switch/mobile also re-hydrates (throttled)
    }
  }
  const onOnline = () => retryStrandedWrite()
  // A bare window `focus` covers regaining focus without a visibility change (e.g. alt-tab back to
  // an already-visible window); it shares the same throttle as the visibility→visible path.
  const onFocus = () => maybeRefreshOnFocus()
  const canListen = typeof window !== 'undefined'
  if (canListen) {
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('online', onOnline)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
  }

  return () => {
    unsubscribe()
    unsubscribeExternal?.()
    unsubscribeSwitch?.()
    // Unregister only if still OURS — a newer attachPersistence may have replaced the registration.
    if (myRegisteredRefresh && registeredRefreshActive === myRegisteredRefresh) registeredRefreshActive = null
    if (myRegisteredFlush && registeredFlushPending === myRegisteredFlush) registeredFlushPending = null
    if (myRegisteredSuspend && registeredSuspendWrites === myRegisteredSuspend) registeredSuspendWrites = null
    if (canListen) {
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
    cancelDebounce() // cancel any pending debounced write
    cancelRetry() // cancel any pending background retry
  }
}

export interface BootstrapOptions {
  debounceMs?: number
  /** Used only on a genuine first run (nothing ever persisted). */
  seedIfEmpty?: AppData
  /** Called when a persistence write fails (e.g. storage quota exceeded, or the
   *  server is unreachable). */
  onError?: (e: unknown) => void
  /** Called after a persistence write succeeds — lets the caller clear a prior
   *  error state once saving recovers (e.g. the server comes back). */
  onSuccess?: () => void
  /** True when a backend is in use — server mode (the default; false only in the demo build,
   *  VITE_CAPACITYLENS_DEMO=1). Enables the per-account switch
   *  orchestrator (P1.13): a tenant pick hydrates that account's slice via `loadAll(accountId)` and
   *  re-seeds the diff snapshot atomically. The demo build (false) leaves the orchestrator inert — `data`
   *  already holds all accounts, so a switch is a pure view change. */
  serverMode?: boolean
}

export async function bootstrap(
  store: StoreApi<StoreState>,
  adapter: PersistenceAdapter,
  opts: BootstrapOptions = {},
): Promise<() => void> {
  let loaded: AppData
  try {
    loaded = await adapter.loadAll()
  } catch (e) {
    // Stored data couldn't be loaded. Render an empty dataset, but DELIBERATELY
    // attach NO persistence and run NO seed-save — the next mutation must not
    // overwrite recoverable data. Route to the recovery UI that fits the failure:
    //   - 'unavailable' (a remote/server load failed): a retry screen. Clearing
    //     local storage would do nothing for a server-backed app that's merely down.
    //   - 'corrupt' (local bytes present but unreadable) or any other throw: the
    //     StorageRecovery reset/import/export screen.
    store.getState().replaceAll(emptyAppData())
    store.getState().setHydrated(true)
    if (e instanceof LoadError && e.kind === 'unavailable') {
      store.getState().setConnectionError(true)
    } else {
      store.getState().setLoadError(true)
    }
    return () => {}
  }
  // Seed only when nothing was ever stored — never resurrect data the user cleared.
  // hasExisting (e.g. the server's /api/meta) decides ONLY whether to seed. If it throws
  // AFTER a successful load, don't discard the loaded data or skip attaching persistence
  // (which would brick saving and show a misleading banner) — fall back to inferring
  // existence from the loaded data itself, so we still skip seeding when there's data.
  let existed: boolean
  try {
    existed = adapter.hasExisting ? await adapter.hasExisting() : !isEmpty(loaded)
  } catch (e) {
    // hasExisting failed AFTER a good load (e.g. the server's /api/meta blipped). The fallback is
    // safe — infer existence from the loaded data, so we still skip seeding when there's data — but
    // leave a dev breadcrumb so a totally-silent meta failure isn't invisible while debugging.
    // Deliberately NOT routed to onError: this is non-fatal and would wrongly raise the persist banner.
    console.warn('bootstrap: hasExisting() failed; inferring existence from loaded data', e)
    existed = !isEmpty(loaded)
  }
  const seedNeeded = !existed && !!opts.seedIfEmpty
  const initial = seedNeeded ? (opts.seedIfEmpty as AppData) : loaded

  store.getState().replaceAll(initial)
  store.getState().setHydrated(true)
  // Guard the first-run seed write: a failure here (quota / private mode) must
  // surface via onError AND must NOT stop persistence from being attached —
  // otherwise the session would silently never save and never show the banner.
  if (seedNeeded) {
    try {
      await adapter.saveAll(initial)
    } catch (e) {
      opts.onError?.(e)
    }
  }

  return attachPersistence(store, adapter, opts.debounceMs ?? 300, opts.onError, opts.onSuccess, opts.serverMode)
}
