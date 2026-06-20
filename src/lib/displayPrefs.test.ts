import { describe, it, expect, beforeEach } from 'vitest'
import {
  defaultSidebarOpen,
  readStoredSidebarOpen,
  writeStoredSidebarOpen,
  readStoredMinimiseWeekends,
  writeStoredMinimiseWeekends,
  readStoredFakeSignedIn,
  writeStoredFakeSignedIn,
  readStoredPlaceholdersEnabled,
  writeStoredPlaceholdersEnabled,
} from './displayPrefs'

describe('sidebar preference', () => {
  beforeEach(() => {
    localStorage.removeItem('floaty/sidebar')
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
    localStorage.setItem('floaty/sidebar', 'sideways')
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
    localStorage.removeItem('floaty/minimiseWeekends')
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
    localStorage.setItem('floaty/minimiseWeekends', 'maybe')
    expect(readStoredMinimiseWeekends()).toBe(true)
  })
})

describe('fake sign-in (cosmetic demo) preference', () => {
  beforeEach(() => {
    localStorage.removeItem('floaty/fakeSignedIn')
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
    localStorage.setItem('floaty/fakeSignedIn', 'perhaps')
    expect(readStoredFakeSignedIn()).toBe(false)
  })
})

describe('placeholders-enabled (device-global view) preference', () => {
  beforeEach(() => {
    localStorage.removeItem('floaty/placeholdersEnabled')
  })

  it('defaults to FALSE (hidden) when the user has never chosen', () => {
    expect(readStoredPlaceholdersEnabled()).toBe(false)
  })

  it('round-trips an explicit on/off choice', () => {
    writeStoredPlaceholdersEnabled(true)
    expect(readStoredPlaceholdersEnabled()).toBe(true)
    writeStoredPlaceholdersEnabled(false)
    expect(readStoredPlaceholdersEnabled()).toBe(false)
  })

  it('treats an unrecognised stored value as the default (hidden)', () => {
    localStorage.setItem('floaty/placeholdersEnabled', 'sometimes')
    expect(readStoredPlaceholdersEnabled()).toBe(false)
  })
})
