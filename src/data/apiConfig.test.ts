import { afterEach, describe, expect, it, vi } from 'vitest'

// isServerConfigured() is the single switch between local-first (localStorage) and the optional
// SQLite-backed server. API_BASE is a module-level const evaluated ONCE at import, so each case must
// stub the env, reset the module registry, then dynamically re-import — importing at the top would
// freeze API_BASE to '' (the default) before any stub runs and silently fail the "configured" case.

afterEach(() => vi.unstubAllEnvs())

describe('apiConfig', () => {
  it('isServerConfigured is true when VITE_FLOATY_API is set', async () => {
    vi.stubEnv('VITE_FLOATY_API', 'https://api.example.com')
    vi.resetModules()
    const { isServerConfigured, API_BASE } = await import('./apiConfig')
    expect(isServerConfigured()).toBe(true)
    expect(API_BASE).toBe('https://api.example.com')
  })

  it('isServerConfigured is false when the env var is unset (local-first default)', async () => {
    vi.stubEnv('VITE_FLOATY_API', '')
    vi.resetModules()
    const { isServerConfigured, API_BASE } = await import('./apiConfig')
    expect(isServerConfigured()).toBe(false)
    expect(API_BASE).toBe('')
  })

  it('trims a trailing slash so `${API_BASE}/api/...` stays clean', async () => {
    vi.stubEnv('VITE_FLOATY_API', 'https://api.example.com///')
    vi.resetModules()
    const { API_BASE, isServerConfigured } = await import('./apiConfig')
    expect(API_BASE).toBe('https://api.example.com')
    expect(isServerConfigured()).toBe(true)
  })
})
