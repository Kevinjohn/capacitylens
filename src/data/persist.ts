import type { StoreApi } from 'zustand'
import { emptyAppData, isEmpty } from '@floaty/shared/types/entities'
import type { AppData } from '@floaty/shared/types/entities'
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
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastData = store.getState().data
  let pending: AppData | null = null // data awaiting a debounced write
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let retryAttempts = 0
  let failedSinceSuccess = false // a write failed and hasn't recovered — gates the online/visible re-attempt
  const MAX_RETRY_ATTEMPTS = 5

  const save = (data: AppData) => {
    pending = null
    // Two-arg then so a throw inside onSuccess isn't misreported as a save error.
    // onSuccess lets the caller CLEAR a prior error state once a write lands again
    // — essential for the server adapter, where a transient network blip sets the
    // banner but the next successful sync should take it back down (and harmless
    // for localStorage, where quota can free up between writes).
    void adapter.saveAll(data).then(
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

  const unsubscribe = store.subscribe((state) => {
    if (state.data === lastData) return // only persist when data actually changes
    lastData = state.data
    retryAttempts = 0 // a fresh user change earns a fresh retry budget
    if (debounceMs <= 0) {
      save(state.data)
      return
    }
    pending = state.data
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => save(state.data), debounceMs)
  })

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

  return attachPersistence(store, adapter, opts.debounceMs ?? 300, opts.onError, opts.onSuccess)
}
