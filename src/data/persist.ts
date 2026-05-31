import type { StoreApi } from 'zustand'
import { emptyAppData } from '@floaty/shared/types/entities'
import type { AppData } from '@floaty/shared/types/entities'
import type { StoreState } from '../store/useStore'
import { LoadError, type PersistenceAdapter } from './PersistenceAdapter'

// Persistence is wired OUTSIDE the store so the store stays a pure state
// container (and is trivially testable). attachPersistence debounce-saves on
// every data change; bootstrap loads (and seeds only on a genuine first run).

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
        if (retryTimer) {
          clearTimeout(retryTimer)
          retryTimer = null
        }
        onSuccess?.()
      },
      (e: unknown) => {
        onError?.(e)
        scheduleRetry()
      },
    )
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

  // Write any debounced-but-not-yet-flushed data immediately — used on page
  // unload so the last edit isn't lost inside the debounce window.
  const flush = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (pending) save(pending)
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

  // The debounce window can outlive the tab. `pagehide` is the reliable
  // close/navigate signal (fires for the bfcache case where `beforeunload`
  // doesn't); `visibilitychange → hidden` covers tab switches and mobile.
  // localStorage writes are synchronous, so flushing here is safe.
  const onPageHide = () => flush()
  const onVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flush()
  }
  const canListen = typeof window !== 'undefined'
  if (canListen) {
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onVisibility)
  }

  return () => {
    unsubscribe()
    if (canListen) {
      window.removeEventListener('pagehide', onPageHide)
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

function isEmpty(data: AppData): boolean {
  return Object.values(data).every((v) => Array.isArray(v) && v.length === 0)
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
  const existed = adapter.hasExisting ? await adapter.hasExisting() : !isEmpty(loaded)
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
