import { describe, it, expect, beforeEach, vi } from 'vitest'
import { attachPersistence, bootstrap } from './persist'
import { LocalStorageAdapter } from './LocalStorageAdapter'
import { LoadError, type PersistenceAdapter } from './PersistenceAdapter'
import { useStore } from '../store/useStore'
import { emptyAppData } from '@floaty/shared/types/entities'
import { seed } from '@floaty/shared/data/seed'
import { DEFAULT_ACCOUNT_ID, resetStoreWithAccount } from '../test/fixtures'

beforeEach(() => {
  localStorage.clear()
  // Seeds a single account AND makes it active, so the add* calls below
  // (which now require an active account) work.
  resetStoreWithAccount()
})

describe('attachPersistence', () => {
  it('persists data changes (immediate mode)', async () => {
    const adapter = new LocalStorageAdapter('floaty/persist-a')
    const detach = attachPersistence(useStore, adapter, 0)
    useStore.getState().addClient({ name: 'Acme', color: '#1' })
    const loaded = await adapter.loadAll()
    expect(loaded.clients).toHaveLength(1)
    detach()
  })

  it('stops persisting after detach', async () => {
    const adapter = new LocalStorageAdapter('floaty/persist-b')
    const detach = attachPersistence(useStore, adapter, 0)
    detach()
    useStore.getState().addClient({ name: 'Acme', color: '#1' })
    expect(await adapter.loadAll()).toEqual(emptyAppData())
  })

  it('flushes a pending debounced write on pagehide (so a tab close does not lose it)', async () => {
    const adapter = new LocalStorageAdapter('floaty/persist-flush')
    const detach = attachPersistence(useStore, adapter, 300) // debounced, NOT immediate
    useStore.getState().addClient({ name: 'Acme', color: '#1' })
    expect((await adapter.loadAll()).clients).toHaveLength(0) // still inside the debounce window
    window.dispatchEvent(new Event('pagehide'))
    expect((await adapter.loadAll()).clients).toHaveLength(1) // flushed synchronously
    detach()
  })

  it('reports a failed write via onError, then a recovered write via onSuccess', async () => {
    // A transient write failure (e.g. server unreachable) should fire onError; the
    // next successful write must fire onSuccess so the caller can clear the banner.
    const adapter = new LocalStorageAdapter('floaty/persist-recover')
    const realSave = adapter.saveAll.bind(adapter)
    let calls = 0
    vi.spyOn(adapter, 'saveAll').mockImplementation(async (d) => {
      calls += 1
      if (calls === 1) throw new Error('write unavailable')
      return realSave(d)
    })
    const onError = vi.fn()
    const onSuccess = vi.fn()
    const detach = attachPersistence(useStore, adapter, 0, onError, onSuccess)

    useStore.getState().addClient({ name: 'A', color: '#111111' })
    await new Promise((r) => setTimeout(r, 5))
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onSuccess).not.toHaveBeenCalled()

    useStore.getState().addClient({ name: 'B', color: '#222222' })
    await new Promise((r) => setTimeout(r, 5))
    expect(onSuccess).toHaveBeenCalled()
    detach()
  })

  it('retries a failed write in the background without waiting for another edit', async () => {
    // Server-backed mode has no localStorage fallback: if a write fails and the user
    // reloads before their next edit, unsynced changes would be lost. A bounded
    // background retry (re-sending the latest store state) self-heals once the
    // adapter recovers — proven here with a one-shot failure + a short backoff.
    vi.useFakeTimers()
    try {
      const adapter = new LocalStorageAdapter('floaty/persist-retry')
      const realSave = adapter.saveAll.bind(adapter)
      let calls = 0
      vi.spyOn(adapter, 'saveAll').mockImplementation(async (d) => {
        calls += 1
        if (calls === 1) throw new Error('temporarily unavailable')
        return realSave(d)
      })
      const onSuccess = vi.fn()
      const detach = attachPersistence(useStore, adapter, 0, undefined, onSuccess)

      useStore.getState().addClient({ name: 'Retry Me', color: '#333333' })
      await vi.advanceTimersByTimeAsync(0) // first attempt → fails, schedules retry
      expect(calls).toBe(1)
      expect(onSuccess).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1000) // backoff #1 (2^0 * 1000ms) → succeeds
      expect(calls).toBe(2)
      expect(onSuccess).toHaveBeenCalled()
      expect((await adapter.loadAll()).clients.some((c) => c.name === 'Retry Me')).toBe(true)
      detach()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('bootstrap', () => {
  it('seeds an empty store and marks it hydrated', async () => {
    const adapter = new LocalStorageAdapter('floaty/persist-c')
    const detach = await bootstrap(useStore, adapter, { debounceMs: 0, seedIfEmpty: seed() })
    expect(useStore.getState().hydrated).toBe(true)
    expect(useStore.getState().data.resources.length).toBeGreaterThan(0)
    // the seed is also persisted on first run
    expect((await adapter.loadAll()).resources.length).toBeGreaterThan(0)
    detach()
  })

  it('does not re-seed after the user has cleared all their data', async () => {
    const adapter = new LocalStorageAdapter('floaty/persist-cleared')
    await adapter.saveAll(emptyAppData()) // user deleted everything; empty IS persisted
    const detach = await bootstrap(useStore, adapter, { debounceMs: 0, seedIfEmpty: seed() })
    expect(useStore.getState().data.resources).toHaveLength(0) // seed must NOT come back
    detach()
  })

  it('a failing first-run seed write still hydrates, reports via onError, and attaches persistence', async () => {
    const adapter = new LocalStorageAdapter('floaty/persist-seedfail')
    const realSave = adapter.saveAll.bind(adapter)
    let calls = 0
    const errors: unknown[] = []
    vi.spyOn(adapter, 'saveAll').mockImplementation(async (d) => {
      calls += 1
      if (calls === 1) throw new Error('quota exceeded') // the seed write fails
      return realSave(d)
    })

    const detach = await bootstrap(useStore, adapter, { debounceMs: 0, seedIfEmpty: seed(), onError: (e) => errors.push(e) })

    expect(useStore.getState().hydrated).toBe(true) // app still renders
    expect(errors).toHaveLength(1) // the failure surfaced (would flip the banner)
    // persistence is STILL attached: a later edit persists via the (now-working) adapter.
    useStore.getState().addClient({ name: 'Later', color: '#1' })
    expect((await adapter.loadAll()).clients.some((c) => c.name === 'Later')).toBe(true)
    detach()
  })

  it('loads existing data without re-seeding', async () => {
    const adapter = new LocalStorageAdapter('floaty/persist-d')
    await adapter.saveAll({ ...emptyAppData(), clients: [{ id: 'c1', accountId: DEFAULT_ACCOUNT_ID, createdAt: 't', updatedAt: 't', name: 'Saved', color: '#1' }] })
    const detach = await bootstrap(useStore, adapter, { debounceMs: 0, seedIfEmpty: seed() })
    expect(useStore.getState().data.clients).toHaveLength(1)
    expect(useStore.getState().data.clients[0].name).toBe('Saved')
    expect(useStore.getState().data.resources).toHaveLength(0)
    detach()
  })

  it('flags loadError and refuses to seed/save over corrupt stored data', async () => {
    const KEY = 'floaty/persist-corrupt'
    localStorage.setItem(KEY, '{ not valid json') // unreadable-but-present bytes
    const adapter = new LocalStorageAdapter(KEY)
    useStore.getState().setLoadError(false)

    const detach = await bootstrap(useStore, adapter, { debounceMs: 0, seedIfEmpty: seed() })

    expect(useStore.getState().loadError).toBe(true)
    expect(useStore.getState().hydrated).toBe(true)
    expect(useStore.getState().data.resources).toHaveLength(0) // rendered empty, not seeded
    expect(localStorage.getItem(KEY)).toBe('{ not valid json') // corrupt bytes untouched

    // No autosave attached: a later mutation must not write over the corrupt data.
    useStore.getState().addAccount({ name: 'New', color: '#111111' })
    await new Promise((r) => setTimeout(r, 5))
    expect(localStorage.getItem(KEY)).toBe('{ not valid json')

    useStore.getState().setLoadError(false)
    detach()
  })

  it('flags connectionError (not loadError) and attaches no persistence when a remote load is unavailable', async () => {
    useStore.getState().setLoadError(false)
    useStore.getState().setConnectionError(false)
    const saveAll = vi.fn().mockResolvedValue(undefined)
    // A server-backed adapter whose load fails (server down / network error).
    const adapter: PersistenceAdapter = {
      loadAll: () => Promise.reject(new LoadError('unavailable', 'server down')),
      saveAll,
    }

    const detach = await bootstrap(useStore, adapter, { debounceMs: 0, seedIfEmpty: seed() })

    // Routed to the retry screen, NOT the corrupt-data reset UI.
    expect(useStore.getState().connectionError).toBe(true)
    expect(useStore.getState().loadError).toBe(false)
    expect(useStore.getState().hydrated).toBe(true)
    expect(useStore.getState().data.resources).toHaveLength(0) // rendered empty, not seeded

    // No autosave attached: an edit must not be pushed as a destructive diff to a
    // server that merely returned once.
    useStore.getState().addAccount({ name: 'New', color: '#111111' })
    await new Promise((r) => setTimeout(r, 5))
    expect(saveAll).not.toHaveBeenCalled()

    useStore.getState().setConnectionError(false)
    detach()
  })
})
