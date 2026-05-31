import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readStoredTheme, writeStoredTheme, resolveTheme, applyThemeToDom } from './theme'

beforeEach(() => localStorage.clear())
afterEach(() => {
  delete document.documentElement.dataset.theme
  vi.unstubAllGlobals()
})

describe('readStoredTheme', () => {
  it('defaults to light when nothing is stored', () => {
    expect(readStoredTheme()).toBe('light')
  })

  it('round-trips a written preference', () => {
    writeStoredTheme('dark')
    expect(readStoredTheme()).toBe('dark')
    writeStoredTheme('system')
    expect(readStoredTheme()).toBe('system')
  })

  it('falls back to light for an unrecognised stored value', () => {
    localStorage.setItem('floaty/theme', 'neon')
    expect(readStoredTheme()).toBe('light')
  })
})

describe('resolveTheme', () => {
  it('returns explicit choices unchanged', () => {
    expect(resolveTheme('light')).toBe('light')
    expect(resolveTheme('dark')).toBe('dark')
  })

  it('resolves system to light when matchMedia is unavailable (jsdom)', () => {
    expect(resolveTheme('system')).toBe('light')
  })

  it('resolves system against prefers-color-scheme when matchMedia exists', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('dark'), addEventListener() {}, removeEventListener() {} }))
    expect(resolveTheme('system')).toBe('dark')
  })
})

describe('applyThemeToDom', () => {
  it('writes the resolved scheme to <html data-theme>', () => {
    applyThemeToDom('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    applyThemeToDom('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})
