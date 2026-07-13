import { describe, it, expect, beforeEach, vi } from 'vitest'
import { LocalStorageAdapter, LocalStorageConflictError } from './LocalStorageAdapter'
import { seed } from '@capacitylens/shared/data/seed'
import { emptyAppData, SCHEMA_VERSION } from '@capacitylens/shared/types/entities'

const KEY = 'capacitylens/test'

describe('LocalStorageAdapter', () => {
  beforeEach(() => localStorage.clear())

  it('returns empty data when nothing is stored', async () => {
    expect(await new LocalStorageAdapter(KEY).loadAll()).toEqual(emptyAppData())
  })

  it('round-trips data: save -> load -> deep equal (proves the backend-swap seam)', async () => {
    const adapter = new LocalStorageAdapter(KEY)
    const data = seed()
    await adapter.saveAll(data)
    expect(await adapter.loadAll()).toEqual(data)
  })

  it('throws (does not return empty) when stored data is corrupt', async () => {
    // Corrupt bytes must be distinguishable from a genuine first run, so bootstrap
    // can refuse to overwrite recoverable-but-unreadable data with a blank save.
    const adapter = new LocalStorageAdapter(KEY)
    localStorage.setItem(KEY, '{ not valid json')
    await expect(adapter.loadAll()).rejects.toThrow()
  })

  it('throws on a parseable-but-damaged blob (a table that is not an array)', async () => {
    // Valid JSON, but `clients` is a string — migrate() would coerce it to [] and silently
    // drop the data; instead we must surface it as corrupt so the recovery UI fires.
    const adapter = new LocalStorageAdapter(KEY)
    localStorage.setItem(KEY, JSON.stringify({ schemaVersion: 3, data: { ...emptyAppData(), clients: 'oops' } }))
    await expect(adapter.loadAll()).rejects.toThrow(/damaged/i)
  })

  it('accepts a partial blob with MISSING tables (migrate fills them; only wrong-typed is corrupt)', async () => {
    const adapter = new LocalStorageAdapter(KEY)
    localStorage.setItem(
      KEY,
      JSON.stringify({ schemaVersion: 3, data: { clients: [{ id: 'c', accountId: 'a', createdAt: 't', updatedAt: 't', name: 'C', color: '#111111' }] } }),
    )
    const loaded = await adapter.loadAll()
    expect(loaded.clients).toHaveLength(1)
    expect(loaded.resources).toEqual([]) // missing table filled, not flagged corrupt
  })

  it('readRaw returns the original bytes (for a recovery export), null when empty', () => {
    const adapter = new LocalStorageAdapter(KEY)
    expect(adapter.readRaw()).toBeNull()
    localStorage.setItem(KEY, '{ broken')
    expect(adapter.readRaw()).toBe('{ broken')
  })

  it('clear removes the stored data', () => {
    const adapter = new LocalStorageAdapter(KEY)
    localStorage.setItem(KEY, 'x')
    adapter.clear()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('rejects a stale tab instead of overwriting a newer whole-tree revision', async () => {
    const initial = new LocalStorageAdapter(KEY)
    await initial.saveAll(seed())
    const tabA = new LocalStorageAdapter(KEY)
    const tabB = new LocalStorageAdapter(KEY)
    const aData = await tabA.loadAll()
    const bData = await tabB.loadAll()

    await tabA.saveAll({
      ...aData,
      clients: [
        ...aData.clients,
        { id: 'a-edit', accountId: aData.accounts[0].id, name: 'A', color: '#111111', createdAt: 't', updatedAt: 't' },
      ],
    })
    await expect(
      tabB.saveAll({
        ...bData,
        clients: [
          ...bData.clients,
          { id: 'b-edit', accountId: bData.accounts[0].id, name: 'B', color: '#222222', createdAt: 't', updatedAt: 't' },
        ],
      }),
    ).rejects.toBeInstanceOf(LocalStorageConflictError)
  })

  it('notifies an idle tab of an external revision and adopts it only when accepted', () => {
    const adapter = new LocalStorageAdapter(KEY)
    const accepted = seed()
    const listener = vi.fn(() => true)
    const unsubscribe = adapter.subscribeExternal(listener)
    const raw = JSON.stringify({ schemaVersion: SCHEMA_VERSION, revision: 7, data: accepted })
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: raw, storageArea: localStorage }))

    expect(listener).toHaveBeenCalledWith(accepted)
    unsubscribe()
  })

  it('treats another tab clearing storage as an external empty revision', () => {
    const adapter = new LocalStorageAdapter(KEY)
    const listener = vi.fn(() => true)
    const unsubscribe = adapter.subscribeExternal(listener)
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: null, storageArea: localStorage }))

    expect(listener).toHaveBeenCalledWith(emptyAppData())
    unsubscribe()
  })
})
