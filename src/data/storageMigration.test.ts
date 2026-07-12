import { describe, it, expect, beforeEach, vi } from 'vitest'
import { migrateLegacyStorageKeys, migrateLegacyStorage } from './storageMigration'
import { STORAGE_KEY_PREFIX } from '@capacitylens/shared/brand'

// A minimal but faithful Storage implementation (insertion-ordered like the real one) so we can test
// the legacy `floaty/` → `capacitylens/` key migration without leaning on a specific jsdom version's
// localStorage. Mirrors the Storage contract the migration uses: length / key(i) / getItem / setItem.
function makeStore(initial: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(initial))
  return {
    get length() {
      return map.size
    },
    key(i: number) {
      return [...map.keys()][i] ?? null
    },
    getItem(k: string) {
      return map.has(k) ? (map.get(k) as string) : null
    },
    setItem(k: string, v: string) {
      map.set(k, v)
    },
    removeItem(k: string) {
      map.delete(k)
    },
    clear() {
      map.clear()
    },
  } as Storage
}

// The full set of legacy device keys (mirrors theme.ts / displayPrefs.ts / RotateHint.ts) plus the
// primary data blob — the one that MUST migrate.
const LEGACY_KEYS = [
  'floaty/v3',
  'floaty/theme',
  'floaty/utilizationPrefs',
  'floaty/barLabelPrefs',
  'floaty/sidebar',
  'floaty/minimiseWeekends',
  'floaty/snapToWeekStart',
  'floaty/fakeSignedIn',
  'floaty/introSeen',
  'floaty/rotateHintDismissed',
] as const

const toNew = (legacy: string) => STORAGE_KEY_PREFIX + legacy.slice('floaty/'.length)

describe('migrateLegacyStorageKeys', () => {
  it('copies EVERY legacy key forward to its capacitylens/ equivalent when the new key is absent', () => {
    const seed = Object.fromEntries(LEGACY_KEYS.map((k, i) => [k, `value-${i}`]))
    const store = makeStore(seed)

    const copied = migrateLegacyStorageKeys(store)

    expect(copied).toBe(LEGACY_KEYS.length)
    for (let i = 0; i < LEGACY_KEYS.length; i++) {
      expect(store.getItem(toNew(LEGACY_KEYS[i]))).toBe(`value-${i}`)
    }
  })

  it('migrates the primary data blob (floaty/v3 → capacitylens/v3) specifically', () => {
    const store = makeStore({ 'floaty/v3': '{"schemaVersion":5,"data":{}}' })
    migrateLegacyStorageKeys(store)
    expect(store.getItem('capacitylens/v3')).toBe('{"schemaVersion":5,"data":{}}')
  })

  it('does NOT overwrite a new key that already exists (new is authoritative)', () => {
    const store = makeStore({ 'floaty/v3': 'OLD', 'capacitylens/v3': 'NEW' })

    const copied = migrateLegacyStorageKeys(store)

    expect(copied).toBe(0)
    expect(store.getItem('capacitylens/v3')).toBe('NEW')
  })

  it('migrates only the absent ones in a mixed state and leaves the present ones intact', () => {
    const store = makeStore({
      'floaty/v3': 'OLD-DATA',
      'capacitylens/v3': 'NEW-DATA', // already migrated → keep
      'floaty/theme': 'dark', // absent on new side → copy
    })

    const copied = migrateLegacyStorageKeys(store)

    expect(copied).toBe(1)
    expect(store.getItem('capacitylens/v3')).toBe('NEW-DATA')
    expect(store.getItem('capacitylens/theme')).toBe('dark')
  })

  it('leaves the legacy keys in place (forward-copy, not move)', () => {
    const store = makeStore({ 'floaty/theme': 'dark' })
    migrateLegacyStorageKeys(store)
    expect(store.getItem('floaty/theme')).toBe('dark')
    expect(store.getItem('capacitylens/theme')).toBe('dark')
  })

  it('ignores unrelated origin keys (no prefix) entirely', () => {
    const store = makeStore({ 'some-other-tool': 'keep', analytics: 'keep' })
    expect(migrateLegacyStorageKeys(store)).toBe(0)
    expect(store.getItem('some-other-tool')).toBe('keep')
    expect(store.getItem('analytics')).toBe('keep')
  })

  it('PROPAGATES a copy failure (quota-style setItem throw) rather than swallowing it', () => {
    const store = makeStore({ 'floaty/v3': 'DATA' })
    const quota = new Error('QuotaExceededError')
    store.setItem = () => {
      throw quota
    }
    // The legacy data was NOT carried forward — the caller must see exactly why.
    expect(() => migrateLegacyStorageKeys(store)).toThrow(quota)
  })
})

describe('migrateLegacyStorage', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('migrates across BOTH localStorage and sessionStorage', () => {
    localStorage.setItem('floaty/v3', 'DATA')
    sessionStorage.setItem('floaty/rotateHintDismissed', '1')

    migrateLegacyStorage()

    expect(localStorage.getItem('capacitylens/v3')).toBe('DATA')
    expect(sessionStorage.getItem('capacitylens/rotateHintDismissed')).toBe('1')
  })

  it('degrades (logs, does not throw) when one store access throws, still migrating the other', () => {
    sessionStorage.setItem('floaty/theme', 'dark')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // Make localStorage access throw once (sandboxed/private-mode shape) without disturbing session.
    const spy = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('SecurityError')
    })

    expect(() => migrateLegacyStorage()).not.toThrow()
    expect(sessionStorage.getItem('capacitylens/theme')).toBe('dark')
    expect(warn).toHaveBeenCalled()

    spy.mockRestore()
    warn.mockRestore()
  })

  // The probe must cover OPERATION-level SecurityErrors too: some environments hand back a Storage
  // object from the accessor but throw on every read (length/key/getItem). That shape means "store
  // unreadable" — a soft-skip — NOT a copy failure (which would block boot into the recovery screen
  // for data that never existed).
  it('degrades (logs, does not throw) when the accessor works but READ operations throw', () => {
    sessionStorage.setItem('floaty/theme', 'dark')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // A Storage whose accessor succeeds but whose operations all raise (permission-denied shape).
    const broken = {
      get length(): number {
        throw new Error('SecurityError')
      },
      key(): string | null {
        throw new Error('SecurityError')
      },
      getItem(): string | null {
        throw new Error('SecurityError')
      },
      setItem() {
        throw new Error('SecurityError')
      },
      removeItem() {},
      clear() {},
    } as unknown as Storage
    const spy = vi.spyOn(window, 'localStorage', 'get').mockReturnValue(broken)

    expect(() => migrateLegacyStorage()).not.toThrow()
    // The other (healthy) store still migrated.
    expect(sessionStorage.getItem('capacitylens/theme')).toBe('dark')
    expect(warn).toHaveBeenCalled()

    spy.mockRestore()
    warn.mockRestore()
  })

  // The catch is the availability PROBE only: once a store is reachable, a per-key copy failure
  // (quota) means legacy data was NOT migrated — it must PROPAGATE to the boot path (which routes
  // it to the storage-recovery screen), never be misclassified as "store unavailable".
  it('PROPAGATES a quota throw during the copy on a reachable store (not soft-skipped)', () => {
    localStorage.setItem('floaty/v3', 'PRECIOUS')
    const quota = new Error('QuotaExceededError')
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw quota
    })

    expect(() => migrateLegacyStorage()).toThrow(quota)
    // The legacy key is untouched — the data stays recoverable.
    expect(localStorage.getItem('floaty/v3')).toBe('PRECIOUS')

    spy.mockRestore()
  })
})

describe('runStorageMigration (boot side-effect)', () => {
  // The module runs the migration at import time, BEFORE React mounts — so instead of throwing
  // (which would blank the page with no ErrorBoundary), it captures the failure for main.tsx to
  // route to the StorageRecovery screen via `setLoadError(true)`.
  it('captures a migration copy failure into storageMigrationError instead of throwing at module scope', async () => {
    vi.resetModules()
    const quota = new Error('QuotaExceededError')
    vi.doMock('./storageMigration', () => ({
      migrateLegacyStorage: () => {
        throw quota
      },
    }))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    const mod = await import('./runStorageMigration')

    expect(mod.storageMigrationError).toBe(quota)
    expect(error).toHaveBeenCalled()

    error.mockRestore()
    vi.doUnmock('./storageMigration')
    vi.resetModules()
  })

  it('leaves storageMigrationError undefined when the migration runs clean', async () => {
    vi.resetModules()
    const mod = await import('./runStorageMigration')
    expect(mod.storageMigrationError).toBeUndefined()
  })
})
