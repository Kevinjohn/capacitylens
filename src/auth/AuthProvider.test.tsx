import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'

// P3.3: the auth boundary's three behaviours. The demo build (VITE_CAPACITYLENS_DEMO=1) is a
// pass-through that performs NO fetch at all; server mode (the default) + authMode 'off' renders
// the app after one /api/auth/me check; a 401 walls everything off behind the LoginScreen. apiConfig
// freezes its env at import, so each case stubs the env, resets the module registry, and re-imports —
// the same pattern as apiConfig.test / buildInfo.test.

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const me = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

async function freshProvider() {
  vi.resetModules()
  const { AuthProvider } = await import('./AuthProvider')
  const { useStore } = await import('../store/useStore')
  return { AuthProvider, useStore }
}

describe('AuthProvider — demo mode (VITE_CAPACITYLENS_DEMO=1)', () => {
  it('renders children and performs no fetch at all', async () => {
    vi.stubEnv('VITE_CAPACITYLENS_DEMO', '1')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const { AuthProvider } = await freshProvider()
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    )
    expect(screen.getByText('app-content')).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('AuthProvider — server mode', () => {
  it('a TRULY empty env (no demo flag, no API origin) is server mode: same-origin /api/auth/me, NOT a pass-through', async () => {
    // Guards the production same-origin deploy: an empty env must drive the credentialed auth check,
    // never the demo pass-through (which would silently bypass auth). API_BASE='' → relative /api/auth/me.
    const fetchSpy = vi.fn(async () => me(200, { authMode: 'off', user: { id: 'demo', name: 'Demo' } }))
    vi.stubGlobal('fetch', fetchSpy)
    const { AuthProvider } = await freshProvider()
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    )
    expect(await screen.findByText('app-content')).toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalledWith('/api/auth/me', { credentials: 'include' })
  })

  it("authMode 'off' renders children after one credentialed /api/auth/me check", async () => {
    vi.stubEnv('VITE_CAPACITYLENS_API', 'http://api.test')
    const fetchSpy = vi.fn(async () => me(200, { authMode: 'off', user: { id: 'demo', name: 'Demo' } }))
    vi.stubGlobal('fetch', fetchSpy)
    const { AuthProvider } = await freshProvider()
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    )
    expect(await screen.findByText('app-content')).toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalledWith('http://api.test/api/auth/me', { credentials: 'include' })
  })

  it('a 401 replaces the app with the login screen (password form)', async () => {
    vi.stubEnv('VITE_CAPACITYLENS_API', 'http://api.test')
    vi.stubGlobal('fetch', vi.fn(async () => me(401, { authMode: 'password' })))
    const { AuthProvider } = await freshProvider()
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    )
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.queryByText('app-content')).not.toBeInTheDocument()
  })

  it('an unreachable server renders the app (ConnectionError owns that failure)', async () => {
    vi.stubEnv('VITE_CAPACITYLENS_API', 'http://api.test')
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('ECONNREFUSED'))))
    const { AuthProvider } = await freshProvider()
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    )
    expect(await screen.findByText('app-content')).toBeInTheDocument()
  })

  it('re-checks on persistError and swaps to the login screen when the session is gone', async () => {
    vi.stubEnv('VITE_CAPACITYLENS_API', 'http://api.test')
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(me(200, { authMode: 'password', user: { id: 'u1', email: 'a@b.test' } }))
      .mockResolvedValue(me(401, { authMode: 'password' }))
    vi.stubGlobal('fetch', fetchSpy)
    const { AuthProvider, useStore } = await freshProvider()
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    )
    expect(await screen.findByText('app-content')).toBeInTheDocument()
    // A failed write raises the banner → the provider re-checks → 401 → login screen.
    act(() => useStore.getState().setPersistError(true))
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })
})
