import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

// P3.3: the auth boundary's three behaviours. The demo build (VITE_CAPACITYLENS_DEMO=1) is a
// pass-through that performs NO fetch at all; server mode (the default) + authMode 'off' renders
// the app after one /api/auth/me check; a 401 walls everything off behind the LoginScreen. apiConfig
// freezes its env at import, so each case stubs the env, resets the module registry, and re-imports —
// the same pattern as apiConfig.test / buildInfo.test.

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks() // console.warn spies in the refreshAuth describe
})

const me = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

async function freshProvider() {
  vi.resetModules()
  const { AuthProvider } = await import('./AuthProvider')
  const { useStore } = await import('../store/useStore')
  const { offlineStateSnapshot, setOfflineReadState } = await import('../data/offlineCache')
  // authContext must come from the SAME fresh module graph as AuthProvider (which imports it
  // internally): a statically-imported useAuth from before vi.resetModules() would read the
  // context object's DEFAULT value, not whatever this AuthProvider instance provides.
  const { useAuth } = await import('./authContext')
  return { AuthProvider, useStore, useAuth, offlineStateSnapshot, setOfflineReadState }
}

/** Renders the two single-company-per-instance fields off `useAuth()` as plain text, so a test can
 *  assert on them without reaching into React internals. Takes the hook as a PROP (rather than a
 *  static import) for the module-identity reason above. */
function Probe({ useAuth }: { useAuth: () => { canCreateAccount: boolean; multiAccount: boolean } }) {
  const { canCreateAccount, multiAccount } = useAuth()
  return <div>{`canCreateAccount:${canCreateAccount} multiAccount:${multiAccount}`}</div>
}

/** Like {@link Probe} but with a button that triggers `refreshAuth` — the fire-and-forget shape
 *  (`void`) the real call sites use, which is safe because refreshAuth is total (never rejects). */
function RefreshProbe({
  useAuth,
}: {
  useAuth: () => { canCreateAccount: boolean; refreshAuth: () => Promise<void> }
}) {
  const { canCreateAccount, refreshAuth } = useAuth()
  return (
    <button type="button" onClick={() => void refreshAuth()}>
      refresh<span>{`canCreateAccount:${canCreateAccount}`}</span>
    </button>
  )
}

/** Renders the SESSION-shaped fields off `useAuth()` (authMode + user id) so a test can assert a
 *  live authenticated snapshot survives — or doesn't — a failing re-check. Hook-as-prop for the
 *  module-identity reason above. */
function SessionProbe({
  useAuth,
}: {
  useAuth: () => { authMode: string; user: { id: string } | null }
}) {
  const { authMode, user } = useAuth()
  return <div>{`authMode:${authMode} user:${user?.id ?? 'none'}`}</div>
}

/** A promise whose resolution the test controls — used to make an EARLIER /me request resolve
 *  AFTER a later one, pinning the request-ordering guard (authRequestSeq). */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
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
    expect(fetchSpy).toHaveBeenCalledWith('/api/auth/me', expect.objectContaining({ credentials: 'include', signal: expect.any(AbortSignal) }))
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
    expect(fetchSpy).toHaveBeenCalledWith('http://api.test/api/auth/me', expect.objectContaining({ credentials: 'include', signal: expect.any(AbortSignal) }))
  })

  it('does not mark a cached active tenant online merely because the identity check succeeds', async () => {
    vi.stubEnv('VITE_CAPACITYLENS_API', 'http://api.test')
    vi.stubGlobal('fetch', vi.fn(async () => me(200, { authMode: 'off', user: null })))
    const { AuthProvider, useStore, offlineStateSnapshot, setOfflineReadState } = await freshProvider()
    useStore.setState({ activeAccountId: 'a1' })
    setOfflineReadState(true, Date.parse('2026-07-17T10:00:00.000Z'))

    render(
      <AuthProvider>
        <div>cached-app-content</div>
      </AuthProvider>,
    )

    expect(await screen.findByText('cached-app-content')).toBeInTheDocument()
    expect(offlineStateSnapshot().readOnly).toBe(true)
  })

  it('a 401 replaces the app with the login screen (password form)', async () => {
    vi.stubEnv('VITE_CAPACITYLENS_API', 'http://api.test')
    vi.stubGlobal('fetch', vi.fn(async () => me(401, { authMode: 'password', providers: [] })))
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
    // A well-formed password-mode body is a real signal, not a guess — no degraded notice.
    expect(screen.queryByText(/sign-in configuration could not be loaded/i)).not.toBeInTheDocument()
  })

  it("a 401 with authMode 'sso' and a valid providers array shows the SSO sign-in form", async () => {
    vi.stubEnv('VITE_CAPACITYLENS_API', 'http://api.test')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        me(401, { authMode: 'sso', providers: [{ id: 'google', label: 'Google', kind: 'social', experimental: true }] }),
      ),
    )
    const { AuthProvider } = await freshProvider()
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    )
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument()
    expect(screen.queryByText('app-content')).not.toBeInTheDocument()
    // A well-formed SSO body is a real signal too — no degraded notice.
    expect(screen.queryByText(/sign-in configuration could not be loaded/i)).not.toBeInTheDocument()
  })

  it('DEFECT A — a 401 whose body OMITS the providers array still lands on the password sign-in wall (version-skew)', async () => {
    // An older/version-skewed server that predates the providers array must NOT strand the signed-out
    // user on a terminal 'invalid configuration' screen — a 401 always offers a way in.
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
    expect(screen.queryByText('The authentication service returned an invalid configuration.')).not.toBeInTheDocument()
    // Merely omitting `providers` is old-server compatibility, not a malformed body — the explicit
    // authMode is still a trustworthy signal, so no degraded notice.
    expect(screen.queryByText(/sign-in configuration could not be loaded/i)).not.toBeInTheDocument()
  })

  it('DEFECT A — a 401 with an empty / HTML / non-JSON body falls back to the password sign-in wall (proxy)', async () => {
    // A proxy returning a plain-HTML 401 (or an empty body) must land on a usable sign-in form, not a
    // dead-end error screen with no way to authenticate.
    vi.stubEnv('VITE_CAPACITYLENS_API', 'http://api.test')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>401</html>', { status: 401 })))
    const { AuthProvider } = await freshProvider()
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    )
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    // The body couldn't be trusted at all — this fallback is a GUESS, not a confirmed password-mode
    // signal, so the login wall must hint that an SSO-only instance could be hiding behind it.
    expect(screen.getByText(/sign-in configuration could not be loaded/i)).toBeInTheDocument()
  })

  it('DEFECT A — a 401 with a junk authMode value falls back to the password sign-in wall WITH the degraded notice', async () => {
    // Distinct from an OMITTED authMode (old-server compat, no notice): here the field is PRESENT
    // but neither 'password' nor 'sso' — a genuinely untrustworthy body, not a version-skew case.
    vi.stubEnv('VITE_CAPACITYLENS_API', 'http://api.test')
    vi.stubGlobal('fetch', vi.fn(async () => me(401, { authMode: 'bogus', providers: [] })))
    const { AuthProvider } = await freshProvider()
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    )
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByText(/sign-in configuration could not be loaded/i)).toBeInTheDocument()
  })

  it('DEFECT A — a NON-401 failure is unchanged: it still renders the retryable auth error boundary', async () => {
    // The lenient 401 handling is scoped to 401 only — a genuinely unexpected status stays fail-closed.
    vi.stubEnv('VITE_CAPACITYLENS_API', 'http://api.test')
    vi.stubGlobal('fetch', vi.fn(async () => me(500, { error: 'boom' })))
    const { AuthProvider } = await freshProvider()
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    )
    expect(await screen.findByRole('heading', { name: 'Unable to verify your session' })).toBeInTheDocument()
    expect(screen.queryByText('app-content')).not.toBeInTheDocument()
  })

  it('password invite routes render before sign-in so the token can onboard a new identity', async () => {
    window.history.pushState({}, '', '/invite/invite-token')
    try {
      vi.stubEnv('VITE_CAPACITYLENS_API', 'http://api.test')
      vi.stubGlobal('fetch', vi.fn(async () => me(401, { authMode: 'password', providers: [] })))
      const { AuthProvider } = await freshProvider()
      render(
        <AuthProvider>
          <div>invite-page</div>
        </AuthProvider>,
      )
      expect(await screen.findByText('invite-page')).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument()
    } finally {
      window.history.pushState({}, '', '/')
    }
  })

  it('SSO invite routes render before sign-in so the provider callback preserves the token', async () => {
    window.history.pushState({}, '', '/invite/invite-token')
    try {
      vi.stubEnv('VITE_CAPACITYLENS_API', 'http://api.test')
      vi.stubGlobal('fetch', vi.fn(async () => me(401, {
        authMode: 'sso',
        providers: [{ id: 'sso', label: 'Single sign-on', kind: 'oidc', experimental: false }],
      })))
      const { AuthProvider } = await freshProvider()
      render(
        <AuthProvider>
          <div>invite-page</div>
        </AuthProvider>,
      )
      expect(await screen.findByText('invite-page')).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument()
    } finally {
      window.history.pushState({}, '', '/')
    }
  })

  it('a 401 with needsSetup:true shows the first-run owner-setup form instead of sign-in', async () => {
    vi.stubEnv('VITE_CAPACITYLENS_API', 'http://api.test')
    vi.stubGlobal('fetch', vi.fn(async () => me(401, { authMode: 'password', needsSetup: true, providers: [] })))
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
    vi.stubGlobal('fetch', vi.fn(async () => me(401, { authMode: 'password', needsSetup: 'yes', providers: [] })))
    const { AuthProvider } = await freshProvider()
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    )
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
  })

  it('an unreachable auth server renders a retryable auth error boundary', async () => {
    vi.stubEnv('VITE_CAPACITYLENS_API', 'http://api.test')
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('ECONNREFUSED'))))
    const { AuthProvider } = await freshProvider()
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    )
    expect(await screen.findByRole('heading', { name: 'Unable to verify your session' })).toBeInTheDocument()
  })

  it('fails closed when an auth-on 200 response has no valid user', async () => {
    vi.stubEnv('VITE_CAPACITYLENS_API', 'http://api.test')
    vi.stubGlobal('fetch', vi.fn(async () => me(200, { authMode: 'password', user: null })))
    const { AuthProvider } = await freshProvider()
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    )
    expect(await screen.findByRole('heading', { name: 'Unable to verify your session' })).toBeInTheDocument()
    expect(screen.queryByText('app-content')).not.toBeInTheDocument()
  })

  it('treats malformed JSON from a reachable auth service as invalid, not offline', async () => {
    vi.stubEnv('VITE_CAPACITYLENS_API', 'http://api.test')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200 })))
    const { AuthProvider } = await freshProvider()
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    )
    expect(await screen.findByRole('heading', { name: 'Unable to verify your session' })).toBeInTheDocument()
    expect(screen.getByText('The authentication service returned an invalid response.')).toBeInTheDocument()
  })

  it('re-checks on persistError and swaps to the login screen when the session is gone', async () => {
    vi.stubEnv('VITE_CAPACITYLENS_API', 'http://api.test')
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(me(200, { authMode: 'password', user: { id: 'u1', email: 'a@b.test' } }))
      .mockResolvedValue(me(401, { authMode: 'password', providers: [] }))
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

  it('persistError re-check that CANNOT resolve /me keeps the live authenticated snapshot (warns, no flip to auth-off)', async () => {
    // The regression this pins: a server outage raises persistError AND makes /me unreachable at
    // the same time. The re-check must not reset a live session to passOpen('off', null) — that
    // drops the sign-out affordance and reshapes member-management mid-outage, and nothing puts it
    // back until a manual reload. Same keep-previous policy as refreshAuth.
    vi.stubEnv('VITE_CAPACITYLENS_API', 'http://api.test')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(me(200, { authMode: 'password', user: { id: 'u1', email: 'a@b.test' } }))
      .mockRejectedValue(new Error('ECONNREFUSED'))
    vi.stubGlobal('fetch', fetchSpy)
    const { AuthProvider, useStore, useAuth } = await freshProvider()
    render(
      <AuthProvider>
        <SessionProbe useAuth={useAuth} />
      </AuthProvider>,
    )
    expect(await screen.findByText('authMode:password user:u1')).toBeInTheDocument()
    act(() => useStore.getState().setPersistError(true))
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('refresh failed; keeping the previous auth snapshot')),
    )
    // Still the LIVE session — not passOpen('off', null).
    expect(screen.getByText('authMode:password user:u1')).toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('a STALE refreshAuth resolving after a newer 401 does not overwrite the login status', async () => {
    // The interleaving this pins (authRequestSeq): refreshAuth fires but its /me hangs; a
    // persistError re-check then resolves a real 401 and shows the login screen; the stale refresh
    // finally resolves with the OLD authenticated snapshot. Applying it would hide the login screen
    // and strand the user on a dead session — the guard must drop the superseded result.
    vi.stubEnv('VITE_CAPACITYLENS_API', 'http://api.test')
    const slow = deferred<Response>()
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(me(200, { authMode: 'password', user: { id: 'u1', email: 'a@b.test' } }))
      .mockImplementationOnce(() => slow.promise) // the refreshAuth click — held open by the test
      .mockResolvedValue(me(401, { authMode: 'password', providers: [] })) // the persistError re-check
    vi.stubGlobal('fetch', fetchSpy)
    const { AuthProvider, useStore, useAuth } = await freshProvider()
    render(
      <AuthProvider>
        <RefreshProbe useAuth={useAuth} />
      </AuthProvider>,
    )
    expect(await screen.findByRole('button', { name: /refresh/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /refresh/ })) // request #2, still in flight
    act(() => useStore.getState().setPersistError(true)) // request #3 → 401 → login screen
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    // NOW the stale request resolves with the old authenticated snapshot…
    await act(async () => {
      slow.resolve(me(200, { authMode: 'password', user: { id: 'u1', email: 'a@b.test' } }))
      await slow.promise
    })
    // …and must be dropped: the login screen stays, the app does not come back on a dead session.
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /refresh/ })).not.toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalledTimes(3)
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

  it('fails closed on a boot-time auth fetch failure', async () => {
    vi.stubEnv('VITE_CAPACITYLENS_API', 'http://api.test')
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('ECONNREFUSED'))))
    const { AuthProvider, useAuth } = await freshProvider()
    render(
      <AuthProvider>
        <Probe useAuth={useAuth} />
      </AuthProvider>,
    )
    expect(await screen.findByRole('heading', { name: 'Unable to verify your session' })).toBeInTheDocument()
  })

  it('fails closed on a 200 response with an off-spec authMode', async () => {
    vi.stubEnv('VITE_CAPACITYLENS_API', 'http://api.test')
    vi.stubGlobal('fetch', vi.fn(async () => me(200, { authMode: 'bogus' })))
    const { AuthProvider, useAuth } = await freshProvider()
    render(
      <AuthProvider>
        <Probe useAuth={useAuth} />
      </AuthProvider>,
    )
    expect(await screen.findByRole('heading', { name: 'Unable to verify your session' })).toBeInTheDocument()
  })

  it('refreshAuth re-asks /api/auth/me and a flipped canCreateAccount reaches consumers', async () => {
    // The server recomputes canCreateAccount per request (account count + membership roles), so a
    // consumer that just changed that state (org create/delete) calls refreshAuth — the boot-time
    // snapshot must not be the last word.
    vi.stubEnv('VITE_CAPACITYLENS_API', 'http://api.test')
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(me(200, { authMode: 'off', user: null, canCreateAccount: false, multiAccount: false }))
      .mockResolvedValue(me(200, { authMode: 'off', user: null, canCreateAccount: true, multiAccount: false }))
    vi.stubGlobal('fetch', fetchSpy)
    const { AuthProvider, useAuth } = await freshProvider()
    render(
      <AuthProvider>
        <RefreshProbe useAuth={useAuth} />
      </AuthProvider>,
    )
    expect(await screen.findByText('canCreateAccount:false')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /refresh/ }))
    expect(await screen.findByText('canCreateAccount:true')).toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('a FAILED refresh keeps the previous (stale) snapshot with a warn breadcrumb — no crash, no reset', async () => {
    // Fail-open posture (see fetchAuthStatus): an unresolved refresh must not flip a live session
    // to authMode 'off' / canCreateAccount true — stale beats wrong, and the server 403 remains
    // the real enforcer. Handled-but-logged per DEFENSIVE-CODING.md §5.
    vi.stubEnv('VITE_CAPACITYLENS_API', 'http://api.test')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(me(200, { authMode: 'off', user: null, canCreateAccount: false, multiAccount: false }))
      .mockRejectedValue(new Error('ECONNREFUSED'))
    vi.stubGlobal('fetch', fetchSpy)
    const { AuthProvider, useAuth } = await freshProvider()
    render(
      <AuthProvider>
        <RefreshProbe useAuth={useAuth} />
      </AuthProvider>,
    )
    expect(await screen.findByText('canCreateAccount:false')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /refresh/ }))
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('refresh failed; keeping the previous auth snapshot')),
    )
    // Degraded to the STALE value — not reset to the fail-open boot default.
    expect(screen.getByText('canCreateAccount:false')).toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalledTimes(2)
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
