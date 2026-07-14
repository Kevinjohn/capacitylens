import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { seed } from '@capacitylens/shared/data/seed'
import { SCOPED_KEYS, emptyAppData, scopedTables, type AppData } from '@capacitylens/shared/types/entities'
import {
  cacheAccountSlice,
  cacheAccountSummaries,
  cacheAuthSnapshot,
  clearAllOfflineData,
  clearOfflineDataForCurrentUser,
  offlineReadEnabled,
  readCachedAccountSummaries,
  readCachedAuthSnapshot,
  readCachedAccountSlice,
  setOfflineReadEnabled,
} from './offlineCache'

const DAY_MS = 24 * 60 * 60 * 1000
const DB_NAME = 'capacitylens-offline-v1'
const STORE_NAME = 'records'

async function putRaw(record: unknown): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(record)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

function authSnapshot(userId: string) {
  return {
    authMode: 'password' as const,
    user: { id: userId, email: `${userId}@example.test`, name: userId },
    canCreateAccount: false,
    multiAccount: false,
  }
}

function accountSlice(accountId: string): AppData {
  const source = seed()
  const slice = emptyAppData()
  slice.accounts = source.accounts.filter((account) => account.id === accountId)
  const sourceTables = scopedTables(source)
  const sliceTables = scopedTables(slice)
  for (const key of SCOPED_KEYS) {
    sliceTables[key] = sourceTables[key].filter((row) => row.accountId === accountId)
  }
  return slice
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
    await cacheAccountSlice('a-studio', accountSlice('a-studio'))

    expect((await readCachedAccountSlice('a-studio'))?.value.accounts[0]?.name).toBe('Studio North')

    clock.mockReturnValue(savedAt + 7 * DAY_MS + 1)
    await expect(readCachedAccountSlice('a-studio')).resolves.toBeNull()
  })

  it('rejects and deletes an envelope whose timestamp is in the future', async () => {
    const now = new Date('2026-07-01T00:00:00.000Z').getTime()
    vi.spyOn(Date, 'now').mockReturnValue(now)
    await cacheAuthSnapshot(authSnapshot('user-a'))
    await putRaw({
      key: `auth:${window.location.origin}`,
      savedAt: now + 1,
      value: authSnapshot('user-a'),
    })

    await expect(readCachedAuthSnapshot()).resolves.toBeNull()
    await expect(readCachedAuthSnapshot()).resolves.toBeNull()
  })

  it('rejects malformed authentication and account-summary payloads', async () => {
    await cacheAuthSnapshot(authSnapshot('user-a'))
    await putRaw({
      key: `auth:${window.location.origin}`,
      savedAt: Date.now(),
      value: { ...authSnapshot('user-a'), authMode: 'superuser' },
    })
    await expect(readCachedAuthSnapshot()).resolves.toBeNull()

    await cacheAuthSnapshot(authSnapshot('user-a'))
    await cacheAccountSummaries([{ id: 'a-studio', name: 'Studio', role: 'owner' }])
    await putRaw({
      key: `accounts:${window.location.origin}:user-a`,
      savedAt: Date.now(),
      value: [{ id: 'a-studio', name: 'Studio', role: 'superuser' }],
    })
    await expect(readCachedAccountSummaries()).resolves.toBeNull()
  })

  it('rejects a cached slice containing rows from another account', async () => {
    await cacheAuthSnapshot(authSnapshot('user-a'))
    await putRaw({
      key: `slice:${window.location.origin}:user-a:a-studio`,
      savedAt: Date.now(),
      value: seed(),
    })

    await expect(readCachedAccountSlice('a-studio')).resolves.toBeNull()
  })

  it('never exposes one verified user\'s account slice to another', async () => {
    await cacheAuthSnapshot(authSnapshot('user-a'))
    await cacheAccountSlice('a-studio', accountSlice('a-studio'))
    await cacheAuthSnapshot(authSnapshot('user-b'))

    await expect(readCachedAccountSlice('a-studio')).resolves.toBeNull()
  })

  it('sign-out clears only the current verified user\'s cache', async () => {
    await cacheAuthSnapshot(authSnapshot('abc'))
    await cacheAccountSlice('a-studio', accountSlice('a-studio'))
    await cacheAuthSnapshot(authSnapshot('abc2'))
    await cacheAccountSlice('a-studio', emptyAppData())

    await clearOfflineDataForCurrentUser()
    await cacheAuthSnapshot(authSnapshot('abc'))

    expect((await readCachedAccountSlice('a-studio'))?.value.accounts[0]?.name).toBe('Studio North')
  })

  it('the explicit device-data wipe clears every user\'s cached slice', async () => {
    await cacheAuthSnapshot(authSnapshot('user-a'))
    await cacheAccountSlice('a-studio', accountSlice('a-studio'))
    await cacheAuthSnapshot(authSnapshot('user-b'))
    await cacheAccountSlice('a-studio', emptyAppData())

    await clearAllOfflineData()
    await cacheAuthSnapshot(authSnapshot('user-a'))

    await expect(readCachedAccountSlice('a-studio')).resolves.toBeNull()
  })
})
