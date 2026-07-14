import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { seed } from '@capacitylens/shared/data/seed'
import {
  cacheAccountSlice,
  cacheAuthSnapshot,
  clearAllOfflineData,
  clearOfflineDataForCurrentUser,
  offlineReadEnabled,
  readCachedAccountSlice,
  setOfflineReadEnabled,
} from './offlineCache'

const DAY_MS = 24 * 60 * 60 * 1000

function authSnapshot(userId: string) {
  return {
    authMode: 'password' as const,
    user: { id: userId, email: `${userId}@example.test`, name: userId },
    canCreateAccount: false,
    multiAccount: false,
  }
}

describe('offline preference', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory())
  })

  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('fails closed when this browser cannot install a service worker', async () => {
    vi.stubGlobal('navigator', {})
    await expect(setOfflineReadEnabled(true)).rejects.toThrow('not supported')
    expect(offlineReadEnabled()).toBe(false)
  })

  it('does not leave the preference enabled when worker registration fails', async () => {
    vi.stubGlobal('navigator', {
      serviceWorker: { register: vi.fn().mockRejectedValue(new Error('registration denied')) },
    })
    await expect(setOfflineReadEnabled(true)).rejects.toThrow('registration denied')
    expect(offlineReadEnabled()).toBe(false)
  })

  it('enables only after successful worker registration', async () => {
    const register = vi.fn().mockResolvedValue({})
    vi.stubGlobal('navigator', { serviceWorker: { register } })
    await setOfflineReadEnabled(true)
    expect(register).toHaveBeenCalledWith('/offline-worker.js', { scope: '/' })
    expect(offlineReadEnabled()).toBe(true)
  })
})

describe('offline tenant cache', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    localStorage.setItem('capacitylens/offlineRead', 'on')
  })

  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('expires account data after seven days', async () => {
    const savedAt = new Date('2026-07-01T00:00:00.000Z').getTime()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(savedAt)
    await cacheAuthSnapshot(authSnapshot('user-a'))
    await cacheAccountSlice('a-studio', seed())

    expect((await readCachedAccountSlice('a-studio'))?.value.accounts[0]?.name).toBe('Studio North')

    clock.mockReturnValue(savedAt + 7 * DAY_MS + 1)
    await expect(readCachedAccountSlice('a-studio')).resolves.toBeNull()
  })

  it('never exposes one verified user\'s account slice to another', async () => {
    await cacheAuthSnapshot(authSnapshot('user-a'))
    await cacheAccountSlice('a-studio', seed())
    await cacheAuthSnapshot(authSnapshot('user-b'))

    await expect(readCachedAccountSlice('a-studio')).resolves.toBeNull()
  })

  it('sign-out clears only the current verified user\'s cache', async () => {
    await cacheAuthSnapshot(authSnapshot('user-a'))
    await cacheAccountSlice('a-studio', seed())
    await cacheAuthSnapshot(authSnapshot('user-b'))
    await cacheAccountSlice('a-studio', { ...seed(), accounts: [] })

    await clearOfflineDataForCurrentUser()
    await cacheAuthSnapshot(authSnapshot('user-a'))

    expect((await readCachedAccountSlice('a-studio'))?.value.accounts[0]?.name).toBe('Studio North')
  })

  it('the explicit device-data wipe clears every user\'s cached slice', async () => {
    await cacheAuthSnapshot(authSnapshot('user-a'))
    await cacheAccountSlice('a-studio', seed())
    await cacheAuthSnapshot(authSnapshot('user-b'))
    await cacheAccountSlice('a-studio', { ...seed(), accounts: [] })

    await clearAllOfflineData()
    await cacheAuthSnapshot(authSnapshot('user-a'))

    await expect(readCachedAccountSlice('a-studio')).resolves.toBeNull()
  })
})
