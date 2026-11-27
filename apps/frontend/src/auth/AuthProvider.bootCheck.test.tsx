import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { MasqueradeBootstrapStatus } from './masqueradeApi'
import { renderFreshProvider, makeMeResponse } from './AuthProviderTestKit'
import { createRequestLog } from '@/test/fetchRequests'

const authBootstrapMocks = vi.hoisted(() => ({
  masqueradeStatus: vi.fn<() => Promise<MasqueradeBootstrapStatus>>(async () => ({
    active: false,
    masqueradeToken: 'idle',
  })),
}))
vi.mock('./masqueradeApi', () => ({
  masqueradeApi: { status: authBootstrapMocks.masqueradeStatus },
}))

afterEach(() => {
  authBootstrapMocks.masqueradeStatus
    .mockReset()
    .mockResolvedValue({ active: false, masqueradeToken: 'idle' })
  localStorage.clear()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AuthProvider — server mode', () => {
  it('uses the same-origin auth endpoint when no API origin is configured', async () => {
    // An empty API origin in a same-origin deployment still performs the credentialed auth check.
    const requests = createRequestLog()
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.record(input, init)
      return makeMeResponse(200, { user: { id: 'demo', name: 'Demo' } })
    })
    vi.stubGlobal('fetch', fetchSpy)
    const { AuthProvider } = await renderFreshProvider()
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>
    )
    expect(
      await screen.findByRole('heading', { name: 'Unable to verify your session' })
    ).toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [request] = await requests.read()
    if (!request) throw new Error('Expected the auth status request')
    expect(request.url.origin).toBe(window.location.origin)
    expect(request.path).toBe('/api/v1/auth/me')
    expect(request.credentials).toBe('include')
    expect(fetchSpy.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  })
  it('rejects a body without a user from a credentialed /api/v1/auth/me check', async () => {
    const requests = createRequestLog()
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.record(input, init)
      return makeMeResponse(200, { user: null })
    })
    vi.stubGlobal('fetch', fetchSpy)
    const { AuthProvider } = await renderFreshProvider()
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>
    )
    expect(
      await screen.findByRole('heading', { name: 'Unable to verify your session' })
    ).toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [request] = await requests.read()
    if (!request) throw new Error('Expected the auth status request')
    expect(request.url.origin).toBe(window.location.origin)
    expect(request.path).toBe('/api/v1/auth/me')
    expect(request.credentials).toBe('include')
    expect(fetchSpy.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  })
  it('keeps the retryable auth error boundary for non-401 failures', async () => {
    // The lenient 401 handling is scoped to 401 only. A genuinely unexpected status stays fail-closed.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => makeMeResponse(500, { error: 'boom' }))
    )
    const { AuthProvider } = await renderFreshProvider()
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>
    )
    expect(
      await screen.findByRole('heading', {
        name: 'Unable to verify your session',
      })
    ).toBeInTheDocument()
    expect(screen.queryByText('app-content')).not.toBeInTheDocument()
  })
  it("surfaces the authentication service's temporary-unavailability message", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => makeMeResponse(503, { error: 'Sign-in is temporarily unavailable.' }))
    )
    const { AuthProvider } = await renderFreshProvider()
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>
    )
    expect(await screen.findByText('Sign-in is temporarily unavailable.')).toBeInTheDocument()
  })
  it('an unreachable auth server renders a retryable auth error boundary', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('ECONNREFUSED')))
    )
    const { AuthProvider } = await renderFreshProvider()
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>
    )
    expect(
      await screen.findByRole('heading', {
        name: 'Unable to verify your session',
      })
    ).toBeInTheDocument()
    expect(screen.queryByText('app-content')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
  })
  it('keeps an auth timeout behind the error boundary even when browser storage has identity data', async () => {
    localStorage.setItem('capacitylens/offlineRead', 'on')
    localStorage.setItem(
      'capacitylens/authSnapshot',
      JSON.stringify({ user: { id: 'stored-user' } })
    )
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('signal timed out', 'TimeoutError'))
    )
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { AuthProvider } = await renderFreshProvider()
    const onCompanyAccessReady = vi.fn()

    render(
      <AuthProvider onCompanyAccessReady={onCompanyAccessReady}>
        <div>app-content</div>
      </AuthProvider>
    )

    expect(
      await screen.findByRole('heading', {
        name: 'Unable to verify your session',
      })
    ).toBeInTheDocument()
    expect(document.title).toBe('Unable to verify your session · CapacityLens')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The authentication service could not be reached.'
    )
    expect(screen.getByText('The authentication service could not be reached.')).toBeInTheDocument()
    expect(screen.queryByText(/stored-user/)).not.toBeInTheDocument()
    expect(onCompanyAccessReady).not.toHaveBeenCalled()
  })
  it.each([
    ['no user', null],
    ['no email', { id: 'u1' }],
    ['an empty email', { id: 'u1', email: '   ' }],
  ])('fails closed when an authenticated 200 response has %s', async (_case, user) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => makeMeResponse(200, { user }))
    )
    const { AuthProvider } = await renderFreshProvider()
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>
    )
    expect(
      await screen.findByRole('heading', { name: 'Unable to verify your session' })
    ).toBeInTheDocument()
    expect(screen.queryByText('app-content')).not.toBeInTheDocument()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('without a valid user'))
  })
  it('treats malformed JSON from a reachable auth service as invalid, not offline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>', { status: 200 }))
    )
    const { AuthProvider } = await renderFreshProvider()
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>
    )
    expect(
      await screen.findByRole('heading', {
        name: 'Unable to verify your session',
      })
    ).toBeInTheDocument()
    expect(
      screen.getByText('The authentication service returned an invalid response.')
    ).toBeInTheDocument()
  })
})

describe('AuthProvider auth state', () => {
  it('fails closed on a boot-time auth fetch failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('ECONNREFUSED')))
    )
    const { AuthProvider } = await renderFreshProvider()
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>
    )
    expect(
      await screen.findByRole('heading', {
        name: 'Unable to verify your session',
      })
    ).toBeInTheDocument()
    expect(screen.queryByText('app-content')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
  })
  it('fails closed on a 200 response with an off-spec body', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => makeMeResponse(200, { privateValue: 'SENTINEL_AUTH_PAYLOAD' }))
    )
    const { AuthProvider } = await renderFreshProvider()
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>
    )
    expect(
      await screen.findByRole('heading', { name: 'Unable to verify your session' })
    ).toBeInTheDocument()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('without a valid user'))
  })
})
