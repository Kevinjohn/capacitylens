import { describe, it, expect, beforeEach } from 'vitest'
import { LocalStorageAdapter } from './LocalStorageAdapter'
import { seed } from '@floaty/shared/data/seed'
import { emptyAppData } from '@floaty/shared/types/entities'

const KEY = 'floaty/test'

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
})
