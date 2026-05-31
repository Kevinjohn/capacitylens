import { describe, it, expect, beforeEach } from 'vitest'
import { LocalStorageAdapter } from './LocalStorageAdapter'
import { seed } from './seed'
import { emptyAppData } from '../types/entities'

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
