import type { AppData } from '@capacitylens/shared/types/entities'
import type { AuthMode, AuthUser } from '../auth/authContext'

const OFFLINE_PREF_KEY = 'capacitylens/offlineRead'
const DB_NAME = 'capacitylens-offline-v1'
const STORE_NAME = 'records'
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

interface CachedRecord<T> {
  key: string
  savedAt: number
  value: T
}

export interface OfflineAuthSnapshot {
  authMode: AuthMode
  user: AuthUser
  canCreateAccount: boolean
  multiAccount: boolean
}

export interface OfflineAccountSummary {
  id: string
  name: string
  role: 'owner' | 'admin' | 'editor' | 'viewer'
}

interface OfflineState {
  readOnly: boolean
  lastUpdated: number | null
}

let scope: { origin: string; userId: string } | null = null
let state: OfflineState = { readOnly: false, lastUpdated: null }
const listeners = new Set<() => void>()

function originKey(): string {
  return typeof window === 'undefined' ? 'server' : window.location.origin
}

function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable on this device.'))
      return
    }
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('The offline cache could not be opened.'))
  })
}

async function put<T>(record: CachedRecord<T>): Promise<void> {
  const db = await openOfflineDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(record)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('The offline cache could not be updated.'))
      tx.onabort = () => reject(tx.error ?? new Error('The offline cache update was aborted.'))
    })
  } finally {
    db.close()
  }
}

async function get<T>(key: string): Promise<CachedRecord<T> | null> {
  const db = await openOfflineDb()
  try {
    const record = await new Promise<CachedRecord<T> | undefined>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key)
      request.onsuccess = () => resolve(request.result as CachedRecord<T> | undefined)
      request.onerror = () => reject(request.error ?? new Error('The offline cache could not be read.'))
    })
    if (!record) return null
    if (Date.now() - record.savedAt <= MAX_AGE_MS) return record
    await deleteKey(key)
    return null
  } finally {
    db.close()
  }
}

async function deleteKey(key: string): Promise<void> {
  const db = await openOfflineDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('The offline cache entry could not be removed.'))
    })
  } finally {
    db.close()
  }
}

function authKey(): string {
  return `auth:${originKey()}`
}

function scopedKey(kind: 'accounts' | 'slice', suffix = ''): string {
  if (!scope) throw new Error('Offline cache scope is unavailable until a user has been verified.')
  return `${kind}:${scope.origin}:${scope.userId}${suffix}`
}

/** Is read-only offline access enabled on this device? Preference failures fail closed. */
export function offlineReadEnabled(): boolean {
  try {
    return localStorage.getItem(OFFLINE_PREF_KEY) === 'on'
  } catch (error) {
    console.warn('offlineCache: the offline preference could not be read; disabling offline access', error)
    return false
  }
}

/** Enable or disable offline access on this device. Disabling also removes the app-shell worker. */
export async function setOfflineReadEnabled(enabled: boolean): Promise<void> {
  if (enabled && !('serviceWorker' in navigator)) {
    throw new Error('Offline access is not supported by this browser.')
  }

  try {
    if (enabled) {
      await navigator.serviceWorker.register('/offline-worker.js', { scope: '/' })
      localStorage.setItem(OFFLINE_PREF_KEY, 'on')
      return
    }

    localStorage.removeItem(OFFLINE_PREF_KEY)
    if (!('serviceWorker' in navigator)) return
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(
      registrations
        .filter((registration) => registration.active?.scriptURL.endsWith('/offline-worker.js'))
        .map((registration) => registration.unregister()),
    )
    if (typeof caches !== 'undefined') await caches.delete('capacitylens-shell-v1')
  } catch (error) {
    // A failed enable must fail closed: without a working shell cache the preference would promise
    // offline access that cannot actually boot. A failed disable remains disabled even if browser
    // cleanup itself was blocked; the stale worker contains no tenant data and is never consulted.
    if (enabled) localStorage.removeItem(OFFLINE_PREF_KEY)
    throw error
  }
}

/** Persist the last verified identity and make it the cache scope for this page. */
export async function cacheAuthSnapshot(snapshot: OfflineAuthSnapshot): Promise<void> {
  if (!offlineReadEnabled()) return
  scope = { origin: originKey(), userId: snapshot.user.id }
  await put({ key: authKey(), savedAt: Date.now(), value: snapshot })
}

/** Restore the last verified identity for an offline boot. Never fabricates a session. */
export async function readCachedAuthSnapshot(): Promise<CachedRecord<OfflineAuthSnapshot> | null> {
  if (!offlineReadEnabled()) return null
  const record = await get<OfflineAuthSnapshot>(authKey())
  if (record) scope = { origin: originKey(), userId: record.value.user.id }
  return record
}

export async function cacheAccountSummaries(summaries: OfflineAccountSummary[]): Promise<void> {
  if (!offlineReadEnabled() || !scope) return
  await put({ key: scopedKey('accounts'), savedAt: Date.now(), value: summaries })
}

export async function readCachedAccountSummaries(): Promise<CachedRecord<OfflineAccountSummary[]> | null> {
  if (!offlineReadEnabled() || !scope) return null
  return get(scopedKey('accounts'))
}

export async function cacheAccountSlice(accountId: string, data: AppData): Promise<void> {
  if (!offlineReadEnabled() || !scope) return
  await put({ key: scopedKey('slice', `:${accountId}`), savedAt: Date.now(), value: data })
}

export async function readCachedAccountSlice(accountId: string): Promise<CachedRecord<AppData> | null> {
  if (!offlineReadEnabled() || !scope) return null
  return get(scopedKey('slice', `:${accountId}`))
}

/** Publish whether the currently rendered slice came from the offline cache. */
export function setOfflineReadState(readOnly: boolean, lastUpdated: number | null = null): void {
  if (state.readOnly === readOnly && state.lastUpdated === lastUpdated) return
  state = { readOnly, lastUpdated }
  for (const listener of listeners) listener()
}

export function offlineStateSnapshot(): OfflineState {
  return state
}

export function subscribeOfflineState(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Remove this user's cached identity, account list and slices. Called before every sign-out. */
export async function clearOfflineDataForCurrentUser(): Promise<void> {
  if (typeof indexedDB === 'undefined') {
    scope = null
    setOfflineReadState(false)
    return
  }
  const currentScope = scope
  const db = await openOfflineDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const request = store.openCursor()
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        const key = String(cursor.key)
        const scopedPrefix = currentScope ? `:${currentScope.origin}:${currentScope.userId}` : null
        if (key === authKey() || (scopedPrefix && key.includes(scopedPrefix))) cursor.delete()
        cursor.continue()
      }
      request.onerror = () => reject(request.error ?? new Error('The offline cache could not be cleared.'))
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('The offline cache could not be cleared.'))
    })
  } finally {
    db.close()
    scope = null
    setOfflineReadState(false)
  }
}

/** Remove every CapacityLens offline identity and account snapshot from this browser profile.
 * Used only by the explicit “Clear device data” action; normal sign-out remains user-scoped. */
export async function clearAllOfflineData(): Promise<void> {
  if (typeof indexedDB === 'undefined') {
    scope = null
    setOfflineReadState(false)
    return
  }
  const db = await openOfflineDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('The offline cache could not be cleared.'))
      tx.onabort = () => reject(tx.error ?? new Error('The offline cache clear was aborted.'))
    })
  } finally {
    db.close()
    scope = null
    setOfflineReadState(false)
  }
}
