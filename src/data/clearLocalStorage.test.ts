import { describe, it, expect, beforeEach, vi } from 'vitest'
import { clearFloatyLocalStorage, FLOATY_KEY_PREFIX } from './clearLocalStorage'

describe('clearFloatyLocalStorage', () => {
  beforeEach(() => localStorage.clear())

  it('removes every floaty/-prefixed key and leaves unrelated origin keys alone', () => {
    localStorage.setItem('floaty/v3', '{"data":1}')
    localStorage.setItem('floaty/theme', 'dark')
    localStorage.setItem('floaty/sidebar', 'true')
    localStorage.setItem('some-other-tool', 'keep')
    localStorage.setItem('analytics', 'keep')

    const removed = clearFloatyLocalStorage()

    expect(removed).toBe(3)
    expect(localStorage.getItem('floaty/v3')).toBeNull()
    expect(localStorage.getItem('floaty/theme')).toBeNull()
    expect(localStorage.getItem('floaty/sidebar')).toBeNull()
    expect(localStorage.getItem('some-other-tool')).toBe('keep')
    expect(localStorage.getItem('analytics')).toBe('keep')
  })

  it('is a no-op (returns 0) when no floaty keys exist', () => {
    localStorage.setItem('unrelated', 'x')
    expect(clearFloatyLocalStorage()).toBe(0)
    expect(localStorage.getItem('unrelated')).toBe('x')
  })

  it('removes ALL matching keys even though removal mutates the key list mid-clear', () => {
    // Snapshotting the keys first is what makes this safe — iterating by live index would
    // skip entries as the list re-indexes on each removeItem.
    for (let i = 0; i < 10; i++) localStorage.setItem(`${FLOATY_KEY_PREFIX}k${i}`, String(i))
    expect(clearFloatyLocalStorage()).toBe(10)
    expect(localStorage.length).toBe(0)
  })

  it('does not swallow a storage failure — it propagates to the caller', () => {
    const store = {
      length: 1,
      key: () => 'floaty/v3',
      removeItem: vi.fn(() => {
        throw new Error('storage disabled')
      }),
      getItem: () => null,
      setItem: () => {},
      clear: () => {},
    } as unknown as Storage
    expect(() => clearFloatyLocalStorage(store)).toThrow('storage disabled')
  })
})
