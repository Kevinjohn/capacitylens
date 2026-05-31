import type { StoreApi } from 'zustand'
import { emptyAppData } from '../types/entities'
import type { AppData } from '../types/entities'
import type { StoreState } from '../store/useStore'
import type { PersistenceAdapter } from './PersistenceAdapter'

// Persistence is wired OUTSIDE the store so the store stays a pure state
// container (and is trivially testable). attachPersistence debounce-saves on
// every data change; bootstrap loads (and seeds only on a genuine first run).

export function attachPersistence(
  store: StoreApi<StoreState>,
  adapter: PersistenceAdapter,
  debounceMs = 300,
  onError?: (e: unknown) => void,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastData = store.getState().data
  let pending: AppData | null = null // data awaiting a debounced write

  const save = (data: AppData) => {
    pending = null
    void adapter.saveAll(data).catch((e) => onError?.(e))
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
  }
}

export interface BootstrapOptions {
  debounceMs?: number
  /** Used only on a genuine first run (nothing ever persisted). */
  seedIfEmpty?: AppData
  /** Called when a persistence write fails (e.g. storage quota exceeded). */
  onError?: (e: unknown) => void
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
  } catch {
    // The stored bytes exist but couldn't be read (corrupt JSON / failed
    // migrate). Render an empty dataset and flag it, but DELIBERATELY attach NO
    // persistence and run NO seed-save — the next mutation must not overwrite the
    // recoverable-but-unreadable data. A recovery UI offers reset/import/export.
    store.getState().replaceAll(emptyAppData())
    store.getState().setLoadError(true)
    store.getState().setHydrated(true)
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

  return attachPersistence(store, adapter, opts.debounceMs ?? 300, opts.onError)
}
