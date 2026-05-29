import { describe, it, expect, beforeEach } from 'vitest'
import { attachPersistence, bootstrap } from './persist'
import { LocalStorageAdapter } from './LocalStorageAdapter'
import { useStore } from '../store/useStore'
import { emptyAppData } from '../types/entities'
import { seed } from './seed'

beforeEach(() => {
  localStorage.clear()
  useStore.getState().replaceAll(emptyAppData())
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

  it('loads existing data without re-seeding', async () => {
    const adapter = new LocalStorageAdapter('floaty/persist-d')
    await adapter.saveAll({ ...emptyAppData(), clients: [{ id: 'c1', createdAt: 't', updatedAt: 't', name: 'Saved', color: '#1' }] })
    const detach = await bootstrap(useStore, adapter, { debounceMs: 0, seedIfEmpty: seed() })
    expect(useStore.getState().data.clients).toHaveLength(1)
    expect(useStore.getState().data.clients[0].name).toBe('Saved')
    expect(useStore.getState().data.resources).toHaveLength(0)
    detach()
  })
})
