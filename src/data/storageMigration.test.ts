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
})
