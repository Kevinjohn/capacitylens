import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { InviteAccept } from './InviteAccept'
import { AuthContext, type AuthContextValue } from '../../auth/authContext'
import { useStore } from '../../store/useStore'
import { resetStoreWithAccount } from '../../test/fixtures'

const authClientMock = vi.hoisted(() => ({
  signInEmail: vi.fn(async () => ({ error: null })),
  signInOauth2: vi.fn(async () => ({ error: null })),
  signInSocial: vi.fn(async () => ({ error: null })),
}))
const handoffMock = vi.hoisted(() => ({
  replaceWithJoinedAccount: vi.fn(),
  replaceWithAccountPicker: vi.fn(),
  reloadCurrentPage: vi.fn(),
}))

vi.mock('../../auth/authClient', () => ({
  authClient: {
    signIn: {
      email: authClientMock.signInEmail,
      oauth2: authClientMock.signInOauth2,
      social: authClientMock.signInSocial,
    },
  },
}))

vi.mock('../../data/apiConfig', () => ({
  API_BASE: 'http://api.test',
  isServerConfigured: () => true,
}))

vi.mock('../../lib/joinedAccountHandoff', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/joinedAccountHandoff')>()),
  replaceWithJoinedAccount: handoffMock.replaceWithJoinedAccount,
  replaceWithAccountPicker: handoffMock.replaceWithAccountPicker,
  reloadCurrentPage: handoffMock.reloadCurrentPage,
}))

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const previewResponse = (role = 'editor'): Response => ({
  ok: true,
  status: 200,
  headers: new Headers(),
  json: async () => ({
    accountName: 'Studio North',
    role,
    expiresAt: '2999-01-01T00:00:00.000Z',
  }),
} as Response)

const signedInAuth: AuthContextValue = {
  authMode: 'password',
  user: { id: 'user-1', name: 'Alex', email: 'alex@example.com' },
  canCreateAccount: true,
  multiAccount: true,
  refreshAuth: async () => {},
  signOut: async () => {},
}

function renderInvite(auth?: AuthContextValue, strict = false) {
  const content = (
    <MemoryRouter initialEntries={['/invite/secret-token']}>
      <Routes>
        <Route path="/invite/:token" element={<InviteAccept />} />
        <Route path="/" element={<div data-testid="app-route">App</div>} />
      </Routes>
    </MemoryRouter>
  )
  const wrapped = auth ? <AuthContext.Provider value={auth}>{content}</AuthContext.Provider> : content
  return render(strict ? <StrictMode>{wrapped}</StrictMode> : wrapped)
}

describe('InviteAccept preview and acceptance', () => {
  it('restarts a cancelled preview effect under React Strict Mode', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(previewResponse()))

    renderInvite(undefined, true)

    expect(await screen.findByTestId('invite-preview')).toHaveTextContent('Studio North')
  })

  it('previews the company and asks an unauthenticated invitee to sign in without consuming the invite', async () => {
    const fetchMock = vi.fn().mockResolvedValue(previewResponse())
    vi.stubGlobal('fetch', fetchMock)

    renderInvite()

    const preview = await screen.findByTestId('invite-preview')
    expect(preview).toHaveTextContent('Studio North')
    expect(preview).toHaveTextContent('Editor')
    expect(preview).toHaveTextContent('Invitation role')
    expect(preview).toHaveTextContent(/keeps your existing role/i)
    expect(preview).toHaveTextContent(/Can edit scheduling data/)
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/api/invites/secret-token/preview',
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false)
  })

  it('starts strict OIDC from the invite URL so the callback returns to the bearer route', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(previewResponse()))
    const user = userEvent.setup()
    renderInvite({
      ...signedInAuth,
      authMode: 'sso',
      user: null,
      providers: [{ id: 'sso', label: 'Single sign-on', kind: 'oidc', experimental: false }],
    })

    await screen.findByTestId('invite-preview')
    await user.click(screen.getByRole('button', { name: 'Continue with Single sign-on' }))
    expect(authClientMock.signInOauth2).toHaveBeenCalledWith({
      providerId: 'sso',
      callbackURL: window.location.href,
      errorCallbackURL: 'http://localhost:3000/?externalSignInError=1',
    })
    expect(authClientMock.signInEmail).not.toHaveBeenCalled()
  })

  it('hands a newly-created invitee to a fresh boot for the verified joined company', async () => {
    resetStoreWithAccount()
    useStore.getState().setActiveAccount(null)
    useStore.getState().setAccountSummaries([])
    authClientMock.signInEmail.mockResolvedValueOnce({ error: null })
    const refreshAuth = vi.fn(async () => {})
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/preview')) return previewResponse('editor')
      if (url.endsWith('/signup') && init?.method === 'POST') {
        return {
          ok: true,
          status: 201,
          headers: new Headers(),
          json: async () => ({ ok: true, accountId: 'joined-account', role: 'editor' }),
        } as Response
      }
      if (url.endsWith('/api/accounts')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => [{ id: 'joined-account', name: 'Studio North', role: 'editor' }],
        } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderInvite({
      ...signedInAuth,
      user: null,
      refreshAuth,
    })
    await screen.findByTestId('invite-preview')
    await user.type(screen.getByLabelText('Name'), 'New Person')
    await user.type(screen.getByLabelText('Email'), 'new@example.com')
    await user.type(screen.getByLabelText('Password'), 'invite-password-123')
    await user.click(screen.getByRole('button', { name: 'Create account and accept' }))

    await vi.waitFor(() => expect(handoffMock.replaceWithJoinedAccount).toHaveBeenCalledWith('joined-account'))
    expect(refreshAuth).toHaveBeenCalledTimes(1)
    expect(useStore.getState().activeAccountId).toBe('joined-account')
    expect(useStore.getState().accountSummaries).toEqual([
      { id: 'joined-account', name: 'Studio North', role: 'editor' },
    ])
  })

  it('requires an explicit accept action and reports the effective role returned by the server', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/preview')) return previewResponse('viewer')
      if (url.endsWith('/accept') && init?.method === 'POST') {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ accountId: 'account-1', role: 'admin' }),
        } as Response
      }
      if (url.endsWith('/api/accounts')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => [{ id: 'account-1', name: 'Studio North', role: 'admin' }],
        } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderInvite(signedInAuth)

    const accept = await screen.findByRole('button', { name: 'Accept invite' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('invite-preview')).toHaveTextContent('Viewer')

    await user.click(accept)

    expect(await screen.findByText('You’ve joined Studio North as Admin.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toHaveLength(1)
  })

  it('retries an unknown accept outcome with the same command identity', async () => {
    const acceptHeaders: Headers[] = []
    let acceptAttempt = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/preview')) return previewResponse('editor')
      if (url.endsWith('/accept') && init?.method === 'POST') {
        acceptHeaders.push(new Headers(init.headers))
        acceptAttempt += 1
        return acceptAttempt === 1
          ? Response.json({ error: 'Temporarily unavailable.' }, { status: 503 })
          : Response.json({ accountId: 'account-1', role: 'editor' })
      }
      if (url.endsWith('/api/accounts')) {
        return Response.json(acceptAttempt > 1
          ? [{ id: 'account-1', name: 'Studio North', role: 'editor' }]
          : [])
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderInvite(signedInAuth)
    await user.click(await screen.findByRole('button', { name: 'Accept invite' }))

    expect(await screen.findByText(/safely retrying this same request/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry accept' }))

    expect(await screen.findByText('You’ve joined Studio North as Editor.')).toBeInTheDocument()
    expect(acceptHeaders).toHaveLength(2)
    expect(acceptHeaders[1]!.get('x-account-command-id'))
      .toBe(acceptHeaders[0]!.get('x-account-command-id'))
    expect(acceptHeaders[1]!.get('idempotency-key'))
      .toBe(acceptHeaders[0]!.get('idempotency-key'))
  })

  it('reports a preview transport failure as safely retryable, not as an unknown mutation outcome', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('offline'))
    vi.stubGlobal('fetch', fetchMock)

    renderInvite(signedInAuth)

    expect(await screen.findByText('Could not reach the server. Check your connection and try again.')).toBeInTheDocument()
    expect(screen.queryByText(/unknown outcome/i)).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reloads the same invite after a transport-unknown signup signs in successfully', async () => {
    authClientMock.signInEmail.mockResolvedValueOnce({ error: null })
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/preview')) return previewResponse('editor')
      if (url.endsWith('/signup') && init?.method === 'POST') throw new TypeError('connection closed')
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderInvite({ ...signedInAuth, user: null })
    await screen.findByTestId('invite-preview')
    await user.type(screen.getByLabelText('Name'), 'Existing Person')
    await user.type(screen.getByLabelText('Email'), 'existing@example.com')
    await user.type(screen.getByLabelText('Password'), 'invite-password-123')
    await user.click(screen.getByRole('button', { name: 'Create account and accept' }))

    await vi.waitFor(() => expect(handoffMock.reloadCurrentPage).toHaveBeenCalledTimes(1))
    expect(handoffMock.replaceWithJoinedAccount).not.toHaveBeenCalled()
    expect(handoffMock.replaceWithAccountPicker).not.toHaveBeenCalled()
  })

  it('probes sign-in recovery after a server-error signup outcome', async () => {
    authClientMock.signInEmail.mockResolvedValueOnce({ error: null })
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/preview')) return previewResponse('editor')
      if (url.endsWith('/signup') && init?.method === 'POST') {
        return Response.json({ error: 'Temporarily unavailable.' }, { status: 503 })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderInvite({ ...signedInAuth, user: null })
    await screen.findByTestId('invite-preview')
    await user.type(screen.getByLabelText('Name'), 'Existing Person')
    await user.type(screen.getByLabelText('Email'), 'existing@example.com')
    await user.type(screen.getByLabelText('Password'), 'invite-password-123')
    await user.click(screen.getByRole('button', { name: 'Create account and accept' }))

    await vi.waitFor(() => expect(handoffMock.reloadCurrentPage).toHaveBeenCalledTimes(1))
  })

  it('restores the form when both transport-unknown signup and its sign-in probe fail', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    authClientMock.signInEmail.mockRejectedValueOnce(new TypeError('still offline'))
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/preview')) return previewResponse('editor')
      if (url.endsWith('/signup') && init?.method === 'POST') throw new TypeError('connection closed')
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderInvite({ ...signedInAuth, user: null })
    await screen.findByTestId('invite-preview')
    await user.type(screen.getByLabelText('Name'), 'Existing Person')
    await user.type(screen.getByLabelText('Email'), 'existing@example.com')
    await user.type(screen.getByLabelText('Password'), 'invite-password-123')
    await user.click(screen.getByRole('button', { name: 'Create account and accept' }))

    expect(await screen.findByText(/Account creation had an unknown outcome/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create account and accept' })).toBeEnabled()
    expect(handoffMock.reloadCurrentPage).not.toHaveBeenCalled()
  })

  it('uses a new command when credential input changes after an unknown signup outcome', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    authClientMock.signInEmail.mockRejectedValueOnce(new TypeError('still offline'))
    const signupHeaders: Headers[] = []
    let signupAttempt = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/preview')) return previewResponse('editor')
      if (url.endsWith('/signup') && init?.method === 'POST') {
        signupHeaders.push(new Headers(init.headers))
        signupAttempt += 1
        if (signupAttempt === 1) throw new TypeError('connection closed')
        return Response.json({ error: 'The invitation is no longer available.', code: 'INVITATION_USED' }, { status: 409 })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderInvite({ ...signedInAuth, user: null })
    await screen.findByTestId('invite-preview')
    await user.type(screen.getByLabelText('Name'), 'Existing Person')
    await user.type(screen.getByLabelText('Email'), 'existing@example.com')
    await user.type(screen.getByLabelText('Password'), 'invite-password-123')
    await user.click(screen.getByRole('button', { name: 'Create account and accept' }))
    await screen.findByText(/Account creation had an unknown outcome/i)

    await user.clear(screen.getByLabelText('Email'))
    await user.type(screen.getByLabelText('Email'), 'corrected@example.com')
    await user.click(screen.getByRole('button', { name: 'Create account and accept' }))
    await screen.findByText('The invitation is no longer available.')

    expect(signupHeaders).toHaveLength(2)
    expect(signupHeaders[1]!.get('x-account-command-id'))
      .not.toBe(signupHeaders[0]!.get('x-account-command-id'))
  })
})
