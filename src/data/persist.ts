import type { StoreApi } from 'zustand'
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

  const save = (data: AppData) => {
    void adapter.saveAll(data).catch((e) => onError?.(e))
  }

  const unsubscribe = store.subscribe((state) => {
    if (state.data === lastData) return // only persist when data actually changes
    lastData = state.data
    if (debounceMs <= 0) {
      save(state.data)
      return
    }
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => save(state.data), debounceMs)
  })

  return () => {
    unsubscribe()
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
  const loaded = await adapter.loadAll()
  // Seed only when nothing was ever stored — never resurrect data the user cleared.
  const existed = adapter.hasExisting ? await adapter.hasExisting() : !isEmpty(loaded)
  const seedNeeded = !existed && !!opts.seedIfEmpty
  const initial = seedNeeded ? (opts.seedIfEmpty as AppData) : loaded

  store.getState().replaceAll(initial)
  store.getState().setHydrated(true)
  if (seedNeeded) await adapter.saveAll(initial)

  return attachPersistence(store, adapter, opts.debounceMs ?? 300, opts.onError)
}
