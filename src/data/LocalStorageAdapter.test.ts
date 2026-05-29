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

  it('recovers from corrupt storage instead of throwing', async () => {
    const adapter = new LocalStorageAdapter(KEY)
    localStorage.setItem(KEY, '{ not valid json')
    expect(await adapter.loadAll()).toEqual(emptyAppData())
  })
})
