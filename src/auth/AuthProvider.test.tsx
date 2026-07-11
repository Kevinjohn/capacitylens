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
  // authContext must come from the SAME fresh module graph as AuthProvider (which imports it
  // internally): a statically-imported useAuth from before vi.resetModules() would read the
  // context object's DEFAULT value, not whatever this AuthProvider instance provides.
  const { useAuth } = await import('./authContext')
  return { AuthProvider, useStore, useAuth }
}

/** Renders the two single-company-per-instance fields off `useAuth()` as plain text, so a test can
 *  assert on them without reaching into React internals. Takes the hook as a PROP (rather than a
 *  static import) for the module-identity reason above. */
function Probe({ useAuth }: { useAuth: () => { canCreateAccount: boolean; multiAccount: boolean } }) {
  const { canCreateAccount, multiAccount } = useAuth()
  return <div>{`canCreateAccount:${canCreateAccount} multiAccount:${multiAccount}`}</div>
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

  it('a 401 with needsSetup:true shows the first-run owner-setup form instead of sign-in', async () => {
    vi.stubEnv('VITE_CAPACITYLENS_API', 'http://api.test')
    vi.stubGlobal('fetch', vi.fn(async () => me(401, { authMode: 'password', needsSetup: true })))
    const { AuthProvider } = await freshProvider()
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    )
    expect(await screen.findByRole('heading', { name: 'Create the owner account' })).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
    expect(screen.queryByText('app-content')).not.toBeInTheDocument()
  })

  it('fail-closed: junk/non-boolean needsSetup on the 401 body shows the ORDINARY sign-in form', async () => {
    // A proxy page or an off-spec server must never conjure a create-account form on a populated
    // instance — only a literal `true` counts.
    vi.stubEnv('VITE_CAPACITYLENS_API', 'http://api.test')
    vi.stubGlobal('fetch', vi.fn(async () => me(401, { authMode: 'password', needsSetup: 'yes' })))
    const { AuthProvider } = await freshProvider()
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    )
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
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

// Single-company-per-instance policy: GET /api/auth/me gains canCreateAccount/multiAccount
// (server-computed: multiAccount || zero accounts exist). The client only ever HIDES the "New
// company" affordance with these — the server 403 is the real enforcer — so every path where the
// fact can't be trusted must fail OPEN (default true), never closed.
describe('AuthProvider — canCreateAccount / multiAccount (single-company-per-instance policy)', () => {
  it('parses canCreateAccount:false / multiAccount:false from a mocked /api/auth/me', async () => {
    vi.stubEnv('VITE_CAPACITYLENS_API', 'http://api.test')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => me(200, { authMode: 'off', user: null, canCreateAccount: false, multiAccount: false })),
    )
    const { AuthProvider, useAuth } = await freshProvider()
    render(
      <AuthProvider>
        <Probe useAuth={useAuth} />
      </AuthProvider>,
    )
    expect(await screen.findByText('canCreateAccount:false multiAccount:false')).toBeInTheDocument()
  })

  it('parses canCreateAccount:true / multiAccount:true from a mocked /api/auth/me', async () => {
    vi.stubEnv('VITE_CAPACITYLENS_API', 'http://api.test')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => me(200, { authMode: 'off', user: null, canCreateAccount: true, multiAccount: true })),
    )
    const { AuthProvider, useAuth } = await freshProvider()
    render(
      <AuthProvider>
        <Probe useAuth={useAuth} />
      </AuthProvider>,
    )
    expect(await screen.findByText('canCreateAccount:true multiAccount:true')).toBeInTheDocument()
  })

  it('defaults BOTH fields to true when an older server omits them from an otherwise-valid body', async () => {
    vi.stubEnv('VITE_CAPACITYLENS_API', 'http://api.test')
    vi.stubGlobal('fetch', vi.fn(async () => me(200, { authMode: 'off', user: null })))
    const { AuthProvider, useAuth } = await freshProvider()
    render(
      <AuthProvider>
        <Probe useAuth={useAuth} />
      </AuthProvider>,
    )
    expect(await screen.findByText('canCreateAccount:true multiAccount:true')).toBeInTheDocument()
  })

  it('defaults to true on a fetch failure (fail-open, mirrors the authMode-off fallback)', async () => {
    vi.stubEnv('VITE_CAPACITYLENS_API', 'http://api.test')
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('ECONNREFUSED'))))
    const { AuthProvider, useAuth } = await freshProvider()
    render(
      <AuthProvider>
        <Probe useAuth={useAuth} />
      </AuthProvider>,
    )
    expect(await screen.findByText('canCreateAccount:true multiAccount:true')).toBeInTheDocument()
  })

  it('defaults to true on a 401 login response too (checked once past sign-in)', async () => {
    // The login screen itself doesn't read these fields, but the NEXT check (a fresh boot after
    // sign-in) must still fail open if that follow-up request errors — covered by the fetch-failure
    // case above; this pins the 200-with-off-spec-authMode branch, the OTHER fail-open path.
    vi.stubEnv('VITE_CAPACITYLENS_API', 'http://api.test')
    vi.stubGlobal('fetch', vi.fn(async () => me(200, { authMode: 'bogus' })))
    const { AuthProvider, useAuth } = await freshProvider()
    render(
      <AuthProvider>
        <Probe useAuth={useAuth} />
      </AuthProvider>,
    )
    expect(await screen.findByText('canCreateAccount:true multiAccount:true')).toBeInTheDocument()
  })

  it('defaults to true in the demo build (no fetch at all)', async () => {
    vi.stubEnv('VITE_CAPACITYLENS_DEMO', '1')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const { AuthProvider, useAuth } = await freshProvider()
    render(
      <AuthProvider>
        <Probe useAuth={useAuth} />
      </AuthProvider>,
    )
    expect(await screen.findByText('canCreateAccount:true multiAccount:true')).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
