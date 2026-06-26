import type { StoreApi } from 'zustand'
import { emptyAppData, isEmpty } from '@capacitylens/shared/types/entities'
import type { AppData } from '@capacitylens/shared/types/entities'
import type { StoreState } from '../store/useStore'
import { LoadError, type PersistenceAdapter } from './PersistenceAdapter'

// Persistence is wired OUTSIDE the store so the store stays a pure state
// container (and is trivially testable). attachPersistence debounce-saves on
// every data change; bootstrap loads (and seeds only on a genuine first run).

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
  // The currently-running save round-trip (P1.13): the account-switch orchestrator AWAITS it so a
  // prior account's save can't land against the new account's snapshot. Resolved (never rejected) so
  // an in-flight FAILED save can still be awaited; settles whether the save succeeds or fails.
  let inFlightSave: Promise<void> | null = null
  const MAX_RETRY_ATTEMPTS = 5

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
        if (retryTimer) {
          clearTimeout(retryTimer)
          retryTimer = null
        }
        onSuccess?.()
      },
      (e: unknown) => {
        failedSinceSuccess = true
        onError?.(e)
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
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
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
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (!pending) return
    const data = pending
    pending = null
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
    retryAttempts = 0 // a fresh user change earns a fresh retry budget
    if (debounceMs <= 0) {
      save(state.data)
      return
    }
    pending = state.data
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => save(state.data), debounceMs)
  })

  // ── Account-switch orchestrator (P1.13) — the §5 correctness core. ───────────────────────────────
  // In SERVER mode only: when the active account changes to a NON-NULL id, hydrate THAT account's
  // slice and re-seed the adapter's diff snapshot to it ATOMICALLY, so a save can never diff one
  // account's data against another's snapshot (which would emit DELETEs for account A + PUTs for
  // account B → cross-account data loss). In LOCAL/OFF mode this is INERT — `data` already holds all
  // accounts, so a switch is a pure view change with nothing to load.
  //
  // SEQUENCE on a switch to `newId`:
  //   (a) AWAIT any in-flight save so a PRIOR account's write can't land against the NEW snapshot;
  //   (b) adapter.loadAll(newId) → returns the new slice AND re-seeds the adapter's lastSynced to it;
  //   (c) replaceAll(newSlice) → `data` becomes the new account (guarded by loadingSlice so the data
  //       subscription doesn't treat it as an edit and push a spurious save);
  //   (d) advance lastData to the loaded slice (the guard already did, belt-and-braces);
  //   (e) a per-switch token: a SECOND switch bumps the token, so a slow first load that resolves
  //       LATE is discarded (it must not seed a stale account over the newer one).
  let switchToken = 0
  let lastActiveAccountId = store.getState().activeAccountId
  const unsubscribeSwitch = serverMode
    ? store.subscribe((state) => {
        const newId = state.activeAccountId
        if (newId === lastActiveAccountId) return
        lastActiveAccountId = newId
        // Null (dropped to the picker) loads nothing — the picker shows accountSummaries, and the
        // next non-null pick will hydrate. Cancel any in-flight switch so its late load can't seed.
        if (newId === null) {
          switchToken += 1
          return
        }
        const myToken = ++switchToken
        void (async () => {
          // (a) Let a prior account's save settle before we re-seed the snapshot.
          if (inFlightSave) await inFlightSave
          if (myToken !== switchToken) return // a newer switch superseded this one
          // Cancel a pending debounced write for the OLD account — it must not flush post-switch.
          if (timer) {
            clearTimeout(timer)
            timer = null
          }
          pending = null
          try {
            // (b) Load the new slice; loadAll(newId) re-seeds the adapter's diff snapshot to it.
            const slice = await adapter.loadAll(newId)
            if (myToken !== switchToken) return // superseded mid-load — discard this stale slice
            // (c)+(d) Swap `data` to the new account WITHOUT it reading as a user edit.
            loadingSlice = true
            store.getState().replaceAll(slice)
            lastData = store.getState().data
            loadingSlice = false
          } catch (e) {
            // A failed slice load surfaces like any load failure: raise the persist banner (a stale
            // banner clears on the next good write). Don't replaceAll — leaving the prior data is
            // safer than blanking it, and the snapshot is unchanged so no bad diff can form.
            if (myToken === switchToken) onError?.(e)
          }
        })()
      })
    : null

  // The debounce window can outlive the tab. `pagehide` is the reliable close/navigate signal
  // (fires for the bfcache case where `beforeunload` doesn't); `visibilitychange → hidden`
  // covers tab switches and mobile. Both route through flushOnUnload (dispatch-all). On a real
  // close, visibilitychange → hidden fires FIRST — while the page is still alive to dispatch —
  // so it does the flush and the subsequent pagehide is a no-op (`pending` already consumed).
  // Coming BACK to the tab (or the browser firing `online`) re-attempts a stranded write.
  const onPageHide = () => flushOnUnload()
  const onVisibility = () => {
    if (typeof document === 'undefined') return
    if (document.visibilityState === 'hidden') flushOnUnload()
    else retryStrandedWrite()
  }
  const onOnline = () => retryStrandedWrite()
  const canListen = typeof window !== 'undefined'
  if (canListen) {
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisibility)
  }

  return () => {
    unsubscribe()
    unsubscribeSwitch?.()
    if (canListen) {
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisibility)
    }
    if (timer) clearTimeout(timer) // cancel any pending debounced write
    if (retryTimer) clearTimeout(retryTimer) // cancel any pending background retry
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
  /** True when a backend is configured (VITE_CAPACITYLENS_API set). Enables the per-account switch
   *  orchestrator (P1.13): a tenant pick hydrates that account's slice via `loadAll(accountId)` and
   *  re-seeds the diff snapshot atomically. Local mode (false) leaves the orchestrator inert — `data`
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
