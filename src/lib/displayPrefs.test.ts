import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
  readStoredUtilizationPrefs,
  writeStoredUtilizationPrefs,
  DEFAULT_UTILIZATION_PREFS,
  readStoredBarLabelPrefs,
  writeStoredBarLabelPrefs,
  DEFAULT_BAR_LABEL_PREFS,
  readStoredIntroSeen,
  writeStoredIntroSeen,
  readStoredGettingStartedDismissed,
  writeStoredGettingStartedDismissed,
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

  it('persists under the documented storage key', () => {
    writeStoredMinimiseWeekends(false)
    expect(localStorage.getItem('capacitylens/minimiseWeekends')).toBe('off')
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

  it('persists under the documented storage key', () => {
    writeStoredFakeSignedIn(true)
    expect(localStorage.getItem('capacitylens/fakeSignedIn')).toBe('on')
  })
})

describe('utilization display preferences', () => {
  beforeEach(() => {
    localStorage.removeItem('capacitylens/utilizationPrefs')
  })

  it('defaults to showing everything', () => {
    expect(DEFAULT_UTILIZATION_PREFS).toEqual({ showTotal: true, showDiscipline: true, showPersonal: true })
  })

  it('reads the show-everything defaults when never chosen', () => {
    expect(readStoredUtilizationPrefs()).toEqual({ showTotal: true, showDiscipline: true, showPersonal: true })
  })

  it('round-trips a mixed explicit choice', () => {
    writeStoredUtilizationPrefs({ showTotal: false, showDiscipline: true, showPersonal: false })
    expect(readStoredUtilizationPrefs()).toEqual({ showTotal: false, showDiscipline: true, showPersonal: false })
  })

  it('fills in defaults for fields missing from a partial stored shape', () => {
    localStorage.setItem('capacitylens/utilizationPrefs', JSON.stringify({ showTotal: false }))
    expect(readStoredUtilizationPrefs()).toEqual({ showTotal: false, showDiscipline: true, showPersonal: true })
  })

  it('falls back to defaults when a stored field is not a boolean', () => {
    localStorage.setItem(
      'capacitylens/utilizationPrefs',
      JSON.stringify({ showTotal: 'yes', showDiscipline: 1, showPersonal: null }),
    )
    expect(readStoredUtilizationPrefs()).toEqual({ showTotal: true, showDiscipline: true, showPersonal: true })
  })

  it('falls back to defaults on malformed JSON', () => {
    localStorage.setItem('capacitylens/utilizationPrefs', '{not json')
    expect(readStoredUtilizationPrefs()).toEqual(DEFAULT_UTILIZATION_PREFS)
  })

  it('swallows a blocked read to the defaults', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    try {
      expect(readStoredUtilizationPrefs()).toEqual(DEFAULT_UTILIZATION_PREFS)
    } finally {
      spy.mockRestore()
    }
  })

  it('does not throw when the write is blocked', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    try {
      expect(() => writeStoredUtilizationPrefs(DEFAULT_UTILIZATION_PREFS)).not.toThrow()
    } finally {
      spy.mockRestore()
    }
  })

  it('persists under the documented storage key', () => {
    writeStoredUtilizationPrefs({ showTotal: false, showDiscipline: false, showPersonal: false })
    expect(localStorage.getItem('capacitylens/utilizationPrefs')).toBe(
      JSON.stringify({ showTotal: false, showDiscipline: false, showPersonal: false }),
    )
  })
})

describe('bar-label display preferences', () => {
  beforeEach(() => {
    localStorage.removeItem('capacitylens/barLabelPrefs')
  })

  it('defaults to showing both client and project', () => {
    expect(DEFAULT_BAR_LABEL_PREFS).toEqual({ showClient: true, showProject: true })
  })

  it('reads the show-everything defaults when never chosen', () => {
    expect(readStoredBarLabelPrefs()).toEqual({ showClient: true, showProject: true })
  })

  it('round-trips a mixed explicit choice', () => {
    writeStoredBarLabelPrefs({ showClient: false, showProject: true })
    expect(readStoredBarLabelPrefs()).toEqual({ showClient: false, showProject: true })
    writeStoredBarLabelPrefs({ showClient: true, showProject: false })
    expect(readStoredBarLabelPrefs()).toEqual({ showClient: true, showProject: false })
  })

  it('falls back to defaults when a stored field is not a boolean', () => {
    localStorage.setItem('capacitylens/barLabelPrefs', JSON.stringify({ showClient: 'yes', showProject: 0 }))
    expect(readStoredBarLabelPrefs()).toEqual({ showClient: true, showProject: true })
  })

  it('falls back to defaults on malformed JSON', () => {
    localStorage.setItem('capacitylens/barLabelPrefs', '{not json')
    expect(readStoredBarLabelPrefs()).toEqual(DEFAULT_BAR_LABEL_PREFS)
  })

  it('swallows a blocked read to the defaults', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    try {
      expect(readStoredBarLabelPrefs()).toEqual(DEFAULT_BAR_LABEL_PREFS)
    } finally {
      spy.mockRestore()
    }
  })

  it('does not throw when the write is blocked', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    try {
      expect(() => writeStoredBarLabelPrefs(DEFAULT_BAR_LABEL_PREFS)).not.toThrow()
    } finally {
      spy.mockRestore()
    }
  })

  it('persists under the documented storage key', () => {
    writeStoredBarLabelPrefs({ showClient: false, showProject: false })
    expect(localStorage.getItem('capacitylens/barLabelPrefs')).toBe(JSON.stringify({ showClient: false, showProject: false }))
  })
})

describe('sidebar default (viewport-derived)', () => {
  afterEach(() => {
    // @ts-expect-error jsdom has no matchMedia by default — restore that absence
    delete window.matchMedia
  })

  it('collapses by default when the viewport matches the small-screen query', () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true })
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia
    expect(defaultSidebarOpen()).toBe(false)
  })

  it('opens by default when the viewport does not match the small-screen query', () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: false })
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia
    expect(defaultSidebarOpen()).toBe(true)
  })

  it('queries the documented small-viewport media query', () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: false })
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia
    defaultSidebarOpen()
    expect(matchMedia).toHaveBeenCalledWith('(max-width: 767px), (max-height: 480px)')
  })

  it('defaults open when matchMedia throws', () => {
    window.matchMedia = (() => {
      throw new Error('blocked')
    }) as unknown as typeof window.matchMedia
    expect(defaultSidebarOpen()).toBe(true)
  })
})

describe('intro-seen preference', () => {
  beforeEach(() => {
    localStorage.removeItem('capacitylens/introSeen')
  })

  it('defaults to FALSE (not yet seen) when never chosen', () => {
    expect(readStoredIntroSeen()).toBe(false)
  })

  it('round-trips an explicit on/off choice', () => {
    writeStoredIntroSeen(true)
    expect(readStoredIntroSeen()).toBe(true)
    writeStoredIntroSeen(false)
    expect(readStoredIntroSeen()).toBe(false)
  })

  it('persists under the documented storage key', () => {
    writeStoredIntroSeen(true)
    expect(localStorage.getItem('capacitylens/introSeen')).toBe('on')
  })
})

describe('getting-started-dismissed preference', () => {
  beforeEach(() => {
    localStorage.removeItem('capacitylens/gettingStartedDismissed')
  })

  it('defaults to FALSE (not dismissed) when never chosen', () => {
    expect(readStoredGettingStartedDismissed()).toBe(false)
  })

  it('round-trips an explicit on/off choice', () => {
    writeStoredGettingStartedDismissed(true)
    expect(readStoredGettingStartedDismissed()).toBe(true)
    writeStoredGettingStartedDismissed(false)
    expect(readStoredGettingStartedDismissed()).toBe(false)
  })

  it('persists under the documented storage key', () => {
    writeStoredGettingStartedDismissed(true)
    expect(localStorage.getItem('capacitylens/gettingStartedDismissed')).toBe('on')
  })
})
