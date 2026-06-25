import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  defaultSidebarOpen,
  readStoredSidebarOpen,
  writeStoredSidebarOpen,
  readStoredMinimiseWeekends,
  writeStoredMinimiseWeekends,
  readStoredSnapToWeekStart,
  writeStoredSnapToWeekStart,
  readStoredFakeSignedIn,
  writeStoredFakeSignedIn,
} from './displayPrefs'

describe('sidebar preference', () => {
  beforeEach(() => {
    localStorage.removeItem('capacitylens/sidebar')
  })

  it('reads null when the user has never chosen', () => {
    expect(readStoredSidebarOpen()).toBeNull()
  })

  it('round-trips an explicit open/closed choice', () => {
    writeStoredSidebarOpen(false)
    expect(readStoredSidebarOpen()).toBe(false)
    writeStoredSidebarOpen(true)
    expect(readStoredSidebarOpen()).toBe(true)
  })

  it('treats an unrecognised stored value as "no choice"', () => {
    localStorage.setItem('capacitylens/sidebar', 'sideways')
    expect(readStoredSidebarOpen()).toBeNull()
  })

  it('defaults open when matchMedia is unavailable (non-browser environment)', () => {
    // jsdom has no matchMedia — the guard must fall back to a large-screen default
    // rather than throwing.
    expect(defaultSidebarOpen()).toBe(true)
  })
})

describe('minimise-weekends preference', () => {
  beforeEach(() => {
    localStorage.removeItem('capacitylens/minimiseWeekends')
  })

  it('defaults to TRUE (on) when the user has never chosen', () => {
    expect(readStoredMinimiseWeekends()).toBe(true)
  })

  it('round-trips an explicit on/off choice', () => {
    writeStoredMinimiseWeekends(false)
    expect(readStoredMinimiseWeekends()).toBe(false)
    writeStoredMinimiseWeekends(true)
    expect(readStoredMinimiseWeekends()).toBe(true)
  })

  it('treats an unrecognised stored value as the default (on)', () => {
    localStorage.setItem('capacitylens/minimiseWeekends', 'maybe')
    expect(readStoredMinimiseWeekends()).toBe(true)
  })
})

describe('snap-to-week-start preference', () => {
  beforeEach(() => {
    localStorage.removeItem('capacitylens/snapToWeekStart')
  })

  it('defaults to TRUE (on) when the user has never chosen', () => {
    expect(readStoredSnapToWeekStart()).toBe(true)
  })

  it('round-trips an explicit on/off choice', () => {
    writeStoredSnapToWeekStart(false)
    expect(readStoredSnapToWeekStart()).toBe(false)
    writeStoredSnapToWeekStart(true)
    expect(readStoredSnapToWeekStart()).toBe(true)
  })

  it('treats an unrecognised stored value as the default (on)', () => {
    localStorage.setItem('capacitylens/snapToWeekStart', 'maybe')
    expect(readStoredSnapToWeekStart()).toBe(true)
  })

  it('swallows a blocked read to the default (on) — a device pref can never corrupt account data', () => {
    // Private mode / quota / a sandboxed iframe can make getItem THROW (not just return null). The
    // read must degrade to the documented default rather than crash boot (DEFENSIVE-CODING.md §5:
    // the ONE category where swallow-to-default is correct — a non-tenant view toggle).
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    try {
      expect(readStoredSnapToWeekStart()).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })

  it('does not throw when the write is blocked (best-effort persist)', () => {
    // A blocked/full setItem must not bubble — the in-memory store still honours the choice for the
    // session; only persistence across reloads is lost.
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    try {
      expect(() => writeStoredSnapToWeekStart(false)).not.toThrow()
    } finally {
      spy.mockRestore()
    }
  })
})

describe('fake sign-in (cosmetic demo) preference', () => {
  beforeEach(() => {
    localStorage.removeItem('capacitylens/fakeSignedIn')
  })

  it('defaults to FALSE (signed out → show the demo sign-in) when never chosen', () => {
    expect(readStoredFakeSignedIn()).toBe(false)
  })

  it('round-trips an explicit on/off choice', () => {
    writeStoredFakeSignedIn(true)
    expect(readStoredFakeSignedIn()).toBe(true)
    writeStoredFakeSignedIn(false)
    expect(readStoredFakeSignedIn()).toBe(false)
  })

  it('treats an unrecognised stored value as the default (signed out)', () => {
    localStorage.setItem('capacitylens/fakeSignedIn', 'perhaps')
    expect(readStoredFakeSignedIn()).toBe(false)
  })
})
