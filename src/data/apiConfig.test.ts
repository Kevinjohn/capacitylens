import { afterEach, describe, expect, it, vi } from 'vitest'

// isServerConfigured() is the single switch between server persistence (the DEFAULT — same-origin or
// a configured API_BASE) and the in-browser localStorage DEMO build (VITE_CAPACITYLENS_DEMO=1, the
// only route to localStorage now). API_BASE is a module-level const evaluated ONCE at import, so each
// case must stub the env, reset the module registry, then dynamically re-import — importing at the
// top would freeze API_BASE to '' before any stub runs and silently fail the "configured" case.

afterEach(() => vi.unstubAllEnvs())

describe('apiConfig', () => {
  it('defaults to server mode when nothing is set (empty API_BASE = same-origin server)', async () => {
    vi.stubEnv('VITE_CAPACITYLENS_API', '')
    vi.stubEnv('VITE_CAPACITYLENS_DEMO', '')
    vi.resetModules()
    const { isServerConfigured, isDemoMode, API_BASE } = await import('./apiConfig')
    expect(isServerConfigured()).toBe(true)
    expect(isDemoMode()).toBe(false)
    expect(API_BASE).toBe('')
  })

  it('is demo mode (not server) when VITE_CAPACITYLENS_DEMO=1', async () => {
    vi.stubEnv('VITE_CAPACITYLENS_DEMO', '1')
    vi.resetModules()
    const { isServerConfigured, isDemoMode } = await import('./apiConfig')
    expect(isDemoMode()).toBe(true)
    expect(isServerConfigured()).toBe(false)
  })

  it('stays server mode with an explicit API origin (API_BASE carries the value)', async () => {
    vi.stubEnv('VITE_CAPACITYLENS_API', 'https://api.example.com')
    vi.stubEnv('VITE_CAPACITYLENS_DEMO', '')
    vi.resetModules()
    const { isServerConfigured, isDemoMode, API_BASE } = await import('./apiConfig')
    expect(isServerConfigured()).toBe(true)
    expect(isDemoMode()).toBe(false)
    expect(API_BASE).toBe('https://api.example.com')
  })

  it('demo wins over a configured API (demo flag forces localStorage)', async () => {
    vi.stubEnv('VITE_CAPACITYLENS_API', 'https://api.example.com')
    vi.stubEnv('VITE_CAPACITYLENS_DEMO', '1')
    vi.resetModules()
    const { isServerConfigured, isDemoMode } = await import('./apiConfig')
    expect(isDemoMode()).toBe(true)
    expect(isServerConfigured()).toBe(false)
  })

  it('trims a trailing slash so `${API_BASE}/api/...` stays clean', async () => {
    vi.stubEnv('VITE_CAPACITYLENS_API', 'https://api.example.com///')
    vi.resetModules()
    const { API_BASE, isServerConfigured } = await import('./apiConfig')
    expect(API_BASE).toBe('https://api.example.com')
    expect(isServerConfigured()).toBe(true)
  })
})
