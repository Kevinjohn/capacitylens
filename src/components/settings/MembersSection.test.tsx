import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MembersSection } from './MembersSection'
import { AuthContext, type AuthContextValue } from '../../auth/authContext'
import { resetStoreWithAccount, DEFAULT_ACCOUNT_ID } from '../../test/fixtures'
import { useStore } from '../../store/useStore'
import { refreshActiveAccountSlice } from '../../data/persist'
import { setOfflineReadState } from '../../data/offlineCache'

// MembersSection is the Team & access management UI. It renders ONLY in auth-on + server mode and
// self-gates via a 403 on the members read. These tests mock apiConfig (so isServerConfigured() is
// true) and fetch, and assert the OWNER-ONLY affordances are hidden for an admin (no owner option, no
// controls on the Owner row), ownership changes only through transfer, and a 403 renders nothing.

// Make the section "enabled": a configured server. The real module reads import.meta.env, which the
// test env leaves unset; mocking it is the clean way to flip server mode on.
vi.mock('../../data/apiConfig', () => ({
  API_BASE: 'http://api.test',
  isServerConfigured: () => true,
}))

vi.mock('../../data/persist', () => ({
  refreshActiveAccountSlice: vi.fn(async () => 'reloaded'),
}))

interface RawMember {
  userId: string
  role: 'owner' | 'admin' | 'editor' | 'viewer'
  status?: string
  createdAt?: string
  name?: string | null
  email?: string | null
  isSelf?: boolean
  mayResetPassword?: boolean
  mayRevokeSessions?: boolean
}

/** Build a fetch mock that answers the members read (and a benign empty invites read). 403 on the
 *  members read self-gates the section. */
function mockFetch(members: RawMember[] | { status: number }) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    if (u.endsWith('/members') && (!init || init.method === undefined || init.method === 'GET')) {
      if ('status' in members) {
        return { ok: false, status: members.status, json: async () => ({}) } as Response
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          members: members.map((m) => ({
            status: 'active',
            createdAt: '2026-01-01T00:00:00.000Z',
            name: null,
            email: `${m.userId}@x.io`,
            isSelf: false,
            mayResetPassword: false,
            mayRevokeSessions: false,
            ...m,
          })),
        }),
      } as unknown as Response
    }
    if (u.endsWith('/invites') && (!init || init.method === undefined || init.method === 'GET')) {
      return { ok: true, status: 200, json: async () => ({ invites: [] }) } as unknown as Response
    }
    if (u.endsWith('/api/accounts') && (!init || init.method === undefined || init.method === 'GET')) {
      const self = Array.isArray(members) ? members.find((member) => member.isSelf) : null
      return {
        ok: true,
        status: 200,
        json: async () => [{
          id: DEFAULT_ACCOUNT_ID,
          name: 'Studio North',
          role: self?.role ?? 'owner',
        }],
      } as unknown as Response
    }
    // Default: a successful no-content mutate.
    return { ok: true, status: 204, json: async () => ({}) } as unknown as Response
  })
}

const authValue = (over: Partial<AuthContextValue> = {}): AuthContextValue => ({
  authMode: 'password',
  user: { id: 'me', email: 'me@x.io' },
  canCreateAccount: true,
  multiAccount: true,
  refreshAuth: async () => {},
  signOut: async () => {},
  ...over,
})

function renderSection(authOverrides: Partial<AuthContextValue> = {}) {
  return render(
    <AuthContext.Provider value={authValue(authOverrides)}>
      <MembersSection />
    </AuthContext.Provider>,
  )
}

beforeEach(() => {
  resetStoreWithAccount() // sets activeAccountId = DEFAULT_ACCOUNT_ID
  setOfflineReadState(false)
  vi.mocked(refreshActiveAccountSlice).mockResolvedValue('reloaded')
})
afterEach(() => {
  setOfflineReadState(false)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('MembersSection — self-gate', () => {
  it('hides the previous account directory while the next account is authorizing', async () => {
    const nextAccountId = 'acc_second'
    let resolveNextMembers: ((response: Response) => void) | undefined
    const fetchMock = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
      const target = String(url)
      const isRead = !init || init.method === undefined || init.method === 'GET'
      if (target.endsWith(`/${DEFAULT_ACCOUNT_ID}/members`) && isRead) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            members: [{
              userId: 'first-owner',
              role: 'owner',
              status: 'active',
              createdAt: '2026-01-01T00:00:00.000Z',
              name: null,
              email: 'first@example.test',
              isSelf: true,
              mayResetPassword: false,
              mayRevokeSessions: false,
            }],
          }),
        } as Response
      }
      if (target.endsWith(`/${nextAccountId}/members`) && isRead) {
        return await new Promise<Response>((resolve) => {
          resolveNextMembers = resolve
        })
      }
      if (target.endsWith('/invites') && isRead) {
        return { ok: true, status: 200, json: async () => ({ invites: [] }) } as Response
      }
      throw new Error(`Unexpected request: ${target}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderSection()
    expect(await screen.findByText('first@example.test')).toBeInTheDocument()

    act(() => useStore.setState({ activeAccountId: nextAccountId }))
    expect(screen.queryByText('first@example.test')).not.toBeInTheDocument()

    await act(async () => {
      resolveNextMembers?.({
        ok: true,
        status: 200,
        json: async () => ({
          members: [{
            userId: 'second-owner',
            role: 'owner',
            status: 'active',
            createdAt: '2026-01-01T00:00:00.000Z',
            name: null,
            email: 'second@example.test',
            isSelf: true,
            mayResetPassword: false,
            mayRevokeSessions: false,
          }],
        }),
      } as Response)
    })
    expect(await screen.findByText('second@example.test')).toBeInTheDocument()
  })

  it('defers privileged directory reads while offline and refreshes them on recovery', async () => {
    const fetchMock = mockFetch([{ userId: 'me', role: 'owner', isSelf: true }])
    vi.stubGlobal('fetch', fetchMock)
    setOfflineReadState(true, Date.parse('2026-07-17T10:00:00.000Z'))
    renderSection()

    await act(async () => {})
    expect(fetchMock).not.toHaveBeenCalled()

    act(() => setOfflineReadState(false))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `http://api.test/api/accounts/${DEFAULT_ACCOUNT_ID}/members`,
      expect.objectContaining({ credentials: 'include' }),
    ))
  })

  it('renders NOTHING when the members read returns 403 (viewer/editor)', async () => {
    vi.stubGlobal('fetch', mockFetch({ status: 403 }))
    const { container } = renderSection()
    // Give the effect a tick to resolve the 403, then assert nothing rendered.
    await waitFor(() => expect(container.querySelector('[data-testid="members-section"]')).toBeNull())
    expect(screen.queryByRole('heading', { name: 'Members' })).not.toBeInTheDocument()
  })

  it('renders nothing when authMode is off', () => {
    vi.stubGlobal('fetch', mockFetch([]))
    const { container } = render(
      <AuthContext.Provider value={authValue({ authMode: 'off' })}>
        <MembersSection />
      </AuthContext.Provider>,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders an empty directory message without exposing an empty ARIA list', async () => {
    vi.stubGlobal('fetch', mockFetch([]))
    renderSection()

    const section = await screen.findByTestId('members-section')
    expect(within(section).queryByTestId('member-row')).not.toBeInTheDocument()
    expect(within(section).queryByRole('list')).not.toBeInTheDocument()
  })

  it('surfaces a malformed member response instead of trusting it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ members: [{ userId: 'me', role: 'owner' }] }),
    }) as unknown as Response))
    renderSection()

    expect(await screen.findByText(/invalid members response/i)).toBeInTheDocument()
    expect(screen.queryByTestId('member-row')).not.toBeInTheDocument()
  })
})

describe('MembersSection — admin affordances', () => {
  const members: RawMember[] = [
    { userId: 'me', role: 'admin', isSelf: true },
    { userId: 'theowner', role: 'owner' },
    { userId: 'theeditor', role: 'editor' },
  ]

  it('does NOT offer the owner option in the invite role picker', async () => {
    vi.stubGlobal('fetch', mockFetch(members))
    renderSection()
    await screen.findByTestId('members-section')

    fireEvent.keyDown(screen.getByTestId('invite-role'), { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: 'Admin' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Editor' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Owner' })).not.toBeInTheDocument()
  })

  it('shows no role control + no Remove on an OWNER row (admin can\'t touch an owner)', async () => {
    vi.stubGlobal('fetch', mockFetch(members))
    renderSection()
    await screen.findByTestId('members-section')

    const rows = await screen.findAllByTestId('member-row')
    const ownerRow = rows.find((r) => within(r).queryByText(/theowner@x\.io/))!
    expect(ownerRow).toBeTruthy()
    // No role <select> and no Remove button on the owner row for an admin.
    expect(within(ownerRow).queryByRole('combobox')).not.toBeInTheDocument()
    expect(within(ownerRow).queryByTestId('member-remove')).not.toBeInTheDocument()

    // The editor row, by contrast, IS manageable by the admin.
    const editorRow = rows.find((r) => within(r).queryByText(/theeditor@x\.io/))!
    expect(within(editorRow).getByRole('combobox')).toBeInTheDocument()
    expect(within(editorRow).getByTestId('member-remove')).toBeInTheDocument()
  })

  it('explains and confirms a role change before sending it', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch(members)
    vi.stubGlobal('fetch', fetchMock)
    const revisionBefore = useStore.getState().membershipRevision
    renderSection()
    const rows = await screen.findAllByTestId('member-row')
    const editorRow = rows.find((r) => within(r).queryByText(/theeditor@x\.io/))!

    fireEvent.keyDown(within(editorRow).getByRole('combobox'), { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('option', { name: 'Viewer' }))
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText(/theeditor@x\.io will become Viewer/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Read-only schedule access/)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/members/theeditor'), expect.anything())

    await user.click(within(dialog).getByRole('button', { name: 'Change role' }))
    expect(fetchMock).toHaveBeenCalledWith(
      `http://api.test/api/accounts/${DEFAULT_ACCOUNT_ID}/members/theeditor`,
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ role: 'viewer' }) }),
    )
    expect(useStore.getState().membershipRevision).toBe(revisionBefore)
  })

  it('invalidates membership projections when an Admin changes their own role', async () => {
    const user = userEvent.setup()
    const refreshAuth = vi.fn(async () => {})
    vi.stubGlobal('fetch', mockFetch(members))
    const revisionBefore = useStore.getState().membershipRevision
    renderSection({ refreshAuth })

    const selfRow = (await screen.findAllByTestId('member-row'))
      .find((row) => within(row).queryByText(/me@x\.io/))!
    fireEvent.keyDown(within(selfRow).getByRole('combobox'), { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('option', { name: 'Editor' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Change role' }))

    await waitFor(() => expect(useStore.getState().membershipRevision).toBe(revisionBefore + 1))
    expect(refreshAuth).toHaveBeenCalledTimes(1)
    expect(refreshActiveAccountSlice).toHaveBeenCalledWith(DEFAULT_ACCOUNT_ID)
  })

  it('closes the company when a self-role refresh restores only a cached offline slice', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', mockFetch(members))
    vi.mocked(refreshActiveAccountSlice).mockImplementationOnce(async () => {
      setOfflineReadState(true, Date.parse('2026-07-17T10:00:00.000Z'))
      return 'reloaded'
    })
    renderSection()

    const selfRow = (await screen.findAllByTestId('member-row'))
      .find((row) => within(row).queryByText(/me@x\.io/))!
    fireEvent.keyDown(within(selfRow).getByRole('combobox'), { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('option', { name: 'Editor' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Change role' }))

    await waitFor(() => expect(useStore.getState().activeAccountId).toBeNull())
    expect(useStore.getState().notice?.message).toMatch(/could not be safely refreshed/i)
  })
})

describe('MembersSection — owner affordances', () => {
  it('never offers Owner as an ordinary role, even to the Owner', async () => {
    const user = userEvent.setup()
    const members: RawMember[] = [
      { userId: 'me', role: 'owner', isSelf: true },
      { userId: 'ed', role: 'editor' },
    ]
    vi.stubGlobal('fetch', mockFetch(members))
    renderSection()
    await screen.findByTestId('members-section')

    fireEvent.keyDown(screen.getByTestId('invite-role'), { key: 'ArrowDown' })
    expect(screen.queryByRole('option', { name: 'Owner' })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')

    const rows = await screen.findAllByTestId('member-row')
    const editorRow = rows.find((r) => within(r).queryByText(/ed@x\.io/))!
    expect(within(editorRow).getByRole('combobox')).toBeInTheDocument()
    fireEvent.keyDown(within(editorRow).getByRole('combobox'), { key: 'ArrowDown' })
    expect(screen.queryByRole('option', { name: 'Owner' })).not.toBeInTheDocument()
  })

  it('keeps the single Owner outside ordinary role and removal controls', async () => {
    const members: RawMember[] = [
      { userId: 'me', role: 'owner', isSelf: true }, // the only owner
      { userId: 'ed', role: 'editor' },
    ]
    vi.stubGlobal('fetch', mockFetch(members))
    renderSection()
    await screen.findByTestId('members-section')

    const rows = await screen.findAllByTestId('member-row')
    const soleOwnerRow = rows.find((r) => within(r).queryByText(/me@x\.io/))!
    expect(within(soleOwnerRow).getByText(/Owner — transfer to change/)).toBeInTheDocument()
    expect(within(soleOwnerRow).queryByRole('combobox')).not.toBeInTheDocument()
    expect(within(soleOwnerRow).queryByTestId('member-remove')).not.toBeInTheDocument()
  })
})

describe('MembersSection — transfer ownership', () => {
  it('an owner sees "Transfer ownership" only on non-self rows', async () => {
    const members: RawMember[] = [
      { userId: 'me', role: 'owner', isSelf: true },
      { userId: 'ed', role: 'editor' },
    ]
    vi.stubGlobal('fetch', mockFetch(members))
    renderSection()
    await screen.findByTestId('members-section')

    const rows = await screen.findAllByTestId('member-row')
    const selfRow = rows.find((r) => within(r).queryByText(/me@x\.io/))!
    const edRow = rows.find((r) => within(r).queryByText(/ed@x\.io/))!
    // The atomic hand-over is offered on an eligible target, never on the caller.
    expect(within(edRow).getByTestId('member-make-owner')).toBeInTheDocument()
    expect(within(selfRow).queryByTestId('member-make-owner')).not.toBeInTheDocument()
  })

  it('an admin never sees the transfer action', async () => {
    const members: RawMember[] = [
      { userId: 'me', role: 'admin', isSelf: true },
      { userId: 'ed', role: 'editor' },
    ]
    vi.stubGlobal('fetch', mockFetch(members))
    renderSection()
    await screen.findByTestId('members-section')
    expect(screen.queryByTestId('member-make-owner')).not.toBeInTheDocument()
  })

  it('confirms the consequence before POSTing the transfer', async () => {
    const user = userEvent.setup()
    const refreshAuth = vi.fn(async () => {})
    const fetchMock = mockFetch([
      { userId: 'me', role: 'owner', isSelf: true },
      { userId: 'ed', role: 'editor' },
    ])
    vi.stubGlobal('fetch', fetchMock)
    const revisionBefore = useStore.getState().membershipRevision
    renderSection({ refreshAuth })
    await screen.findByTestId('members-section')

    const edRow = (await screen.findAllByTestId('member-row')).find((r) => within(r).queryByText(/ed@x\.io/))!
    await user.click(within(edRow).getByTestId('member-make-owner'))
    expect(screen.getByText(/You will become an Admin/)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/transfer-ownership'),
      expect.anything(),
    )
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Transfer ownership' }))
    expect(fetchMock).toHaveBeenCalledWith(
      `http://api.test/api/accounts/${DEFAULT_ACCOUNT_ID}/transfer-ownership`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ toUserId: 'ed' }) }),
    )
    await waitFor(() => expect(useStore.getState().membershipRevision).toBe(revisionBefore + 1))
    expect(refreshAuth).toHaveBeenCalledTimes(1)
    expect(refreshActiveAccountSlice).toHaveBeenCalledWith(DEFAULT_ACCOUNT_ID)
  })

  it('surfaces the server error when a transfer is refused', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.endsWith('/members') && (!init || init.method === undefined || init.method === 'GET')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            members: [
              { userId: 'me', role: 'owner', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', name: null, email: 'me@x.io', isSelf: true, mayResetPassword: false, mayRevokeSessions: true },
              { userId: 'ed', role: 'editor', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', name: null, email: 'ed@x.io', isSelf: false, mayResetPassword: false, mayRevokeSessions: true },
            ],
          }),
        } as unknown as Response
      }
      if (u.endsWith('/invites') && (!init || init.method === undefined || init.method === 'GET')) {
        return { ok: true, status: 200, json: async () => ({ invites: [] }) } as unknown as Response
      }
      if (u.endsWith('/transfer-ownership')) {
        return { ok: false, status: 403, json: async () => ({ error: 'Only the owner can transfer ownership.' }) } as unknown as Response
      }
      return { ok: true, status: 204, json: async () => ({}) } as unknown as Response
    })
    vi.stubGlobal('fetch', fetchMock)
    renderSection()
    await screen.findByTestId('members-section')

    const edRow = (await screen.findAllByTestId('member-row')).find((r) => within(r).queryByText(/ed@x\.io/))!
    await user.click(within(edRow).getByTestId('member-make-owner'))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Transfer ownership' }))
    // The server's own message is preferred over the generic fallback (body.error ?? …).
    expect(await screen.findByText('Only the owner can transfer ownership.')).toBeInTheDocument()
  })

  it('reconciles an unknown self-demotion even after member reads become forbidden', async () => {
    const user = userEvent.setup()
    let mutationDispatched = false
    const refreshAuth = vi.fn(async () => {})
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.endsWith('/members/me') && init?.method === 'PATCH') {
        mutationDispatched = true
        throw new TypeError('connection closed after dispatch')
      }
      if (u.endsWith('/api/accounts')) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: DEFAULT_ACCOUNT_ID, name: 'Studio North', role: 'editor' }],
        } as unknown as Response
      }
      if (u.endsWith('/members') && (!init || init.method === undefined || init.method === 'GET')) {
        if (mutationDispatched) {
          return { ok: false, status: 403, json: async () => ({ error: 'Forbidden.' }) } as unknown as Response
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            members: [
              { userId: 'owner', role: 'owner', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', name: null, email: 'owner@x.io', isSelf: false, mayResetPassword: false, mayRevokeSessions: false },
              { userId: 'me', role: 'admin', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', name: null, email: 'me@x.io', isSelf: true, mayResetPassword: true, mayRevokeSessions: true },
              { userId: 'ed', role: 'editor', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', name: null, email: 'ed@x.io', isSelf: false, mayResetPassword: true, mayRevokeSessions: true },
            ],
          }),
        } as unknown as Response
      }
      if (u.endsWith('/invites')) {
        return mutationDispatched
          ? { ok: false, status: 403, json: async () => ({ error: 'Forbidden.' }) } as unknown as Response
          : { ok: true, status: 200, json: async () => ({ invites: [] }) } as unknown as Response
      }
      throw new Error(`Unexpected request: ${u}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const revisionBefore = useStore.getState().membershipRevision
    renderSection({ refreshAuth })
    await screen.findByTestId('members-section')

    const self = (await screen.findAllByTestId('member-row'))
      .find((row) => within(row).queryByText(/me@x\.io/))!
    fireEvent.keyDown(within(self).getByRole('combobox'), { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('option', { name: 'Editor' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Change role' }))

    await waitFor(() => expect(useStore.getState().membershipRevision).toBe(revisionBefore + 1))
    expect(refreshAuth).toHaveBeenCalledTimes(1)
    expect(refreshActiveAccountSlice).toHaveBeenCalledWith(DEFAULT_ACCOUNT_ID)
    expect(useStore.getState().activeAccountId).toBe(DEFAULT_ACCOUNT_ID)
    expect(useStore.getState().notice?.message).toMatch(/Your access was refreshed; verify the result/i)
    expect(useStore.getState().notice?.message).not.toMatch(/Reload the page/i)
  })

  it('permits only one member mutation while an action is in flight', async () => {
    let release: (() => void) | null = null
    const reads = mockFetch([
      { userId: 'me', role: 'owner', isSelf: true },
      { userId: 'ed', role: 'editor' },
    ])
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST' || init?.method === 'DELETE' || init?.method === 'PATCH') {
        return new Promise<Response>((resolve) => {
          release = () => resolve({ ok: true, status: 204, json: async () => ({}) } as unknown as Response)
        })
      }
      return reads(url, init)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderSection()
    const editorRow = (await screen.findAllByTestId('member-row')).find((row) => within(row).queryByText(/ed@x\.io/))!

    fireEvent.click(within(editorRow).getByTestId('member-make-owner'))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Transfer ownership' }))
    fireEvent.click(within(editorRow).getByTestId('member-remove'))

    const mutations = fetchMock.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET')
    expect(mutations).toHaveLength(1)
    expect(String(mutations[0][0])).toContain('/transfer-ownership')
    release!()
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(3))
  })
})

describe('MembersSection — invite mint', () => {
  it('shows the selected invite role consequences before creating the link', async () => {
    vi.stubGlobal('fetch', mockFetch([{ userId: 'me', role: 'owner', isSelf: true }]))
    renderSection()
    await screen.findByTestId('members-section')

    expect(screen.getByTestId('invite-role-summary')).toHaveTextContent(/Can edit scheduling data/)
    fireEvent.keyDown(screen.getByTestId('invite-role'), { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('option', { name: 'Viewer' }))
    expect(screen.getByTestId('invite-role-summary')).toHaveTextContent(/Read-only schedule access/)
  })

  it('shows the invite link ONCE on a 201, built from the returned token', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.endsWith('/members')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            members: [{
              userId: 'me',
              role: 'owner',
              status: 'active',
              createdAt: '2026-01-01T00:00:00.000Z',
              name: null,
              email: 'me@x.io',
              isSelf: true,
              mayResetPassword: false,
              mayRevokeSessions: false,
            }],
          }),
        } as unknown as Response
      }
      if (u.endsWith('/invites') && (!init || init.method === 'GET' || init.method === undefined)) {
        return { ok: true, status: 200, json: async () => ({ invites: [] }) } as unknown as Response
      }
      if (u.endsWith('/api/invites') && init?.method === 'POST') {
        return { ok: true, status: 201, json: async () => ({ token: 'TOK123', role: 'editor' }) } as unknown as Response
      }
      return { ok: true, status: 204, json: async () => ({}) } as unknown as Response
    })
    vi.stubGlobal('fetch', fetchMock)
    renderSection()
    await screen.findByTestId('members-section')

    await user.click(screen.getByTestId('invite-submit'))
    const link = await screen.findByTestId('invite-link')
    expect(link).toHaveTextContent('/invite/TOK123')
  })

  it('discards account-local bearer links and controls immediately when the account changes', async () => {
    const nextAccountId = 'acc_second'
    const fetchMock = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
      const target = String(url)
      const isRead = !init || init.method === undefined || init.method === 'GET'
      if (target.endsWith(`/${DEFAULT_ACCOUNT_ID}/members`) && isRead) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            members: [{
              userId: 'me',
              role: 'owner',
              status: 'active',
              createdAt: '2026-01-01T00:00:00.000Z',
              name: null,
              email: 'me@x.io',
              isSelf: true,
              mayResetPassword: false,
              mayRevokeSessions: false,
            }],
          }),
        } as Response
      }
      if (target.endsWith(`/${nextAccountId}/members`) && isRead) {
        return await new Promise<Response>(() => {})
      }
      if (target.endsWith('/invites') && isRead) {
        return { ok: true, status: 200, json: async () => ({ invites: [] }) } as Response
      }
      if (target.endsWith('/api/invites') && init?.method === 'POST') {
        return {
          ok: true,
          status: 201,
          json: async () => ({ id: 'inv-new', token: 'ACCOUNT_A_TOKEN' }),
        } as Response
      }
      throw new Error(`Unexpected request: ${target}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderSection()
    await screen.findByTestId('members-section')

    fireEvent.click(screen.getByTestId('invite-submit'))
    expect(await screen.findByTestId('invite-link')).toHaveTextContent('/invite/ACCOUNT_A_TOKEN')

    act(() => useStore.setState({ activeAccountId: nextAccountId }))
    expect(screen.queryByTestId('invite-link')).not.toBeInTheDocument()
    expect(screen.queryByTestId('invite-submit')).not.toBeInTheDocument()
  })

  it('does not publish a late clipboard result into a different account', async () => {
    const nextAccountId = 'acc_second'
    let finishCopy: (() => void) | undefined
    const writeText = vi.fn(() => new Promise<void>((resolve) => {
      finishCopy = resolve
    }))
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText } as unknown as Clipboard)
    const fetchMock = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
      const target = String(url)
      const isRead = !init || init.method === undefined || init.method === 'GET'
      if (target.endsWith('/members') && isRead) {
        const second = target.includes(`/${nextAccountId}/`)
        return {
          ok: true,
          status: 200,
          json: async () => ({
            members: [{
              userId: second ? 'second-owner' : 'me',
              role: 'owner',
              status: 'active',
              createdAt: '2026-01-01T00:00:00.000Z',
              name: null,
              email: second ? 'second@example.test' : 'me@x.io',
              isSelf: true,
              mayResetPassword: false,
              mayRevokeSessions: false,
            }],
          }),
        } as Response
      }
      if (target.endsWith('/invites') && isRead) {
        return { ok: true, status: 200, json: async () => ({ invites: [] }) } as Response
      }
      if (target.endsWith('/api/invites') && init?.method === 'POST') {
        return {
          ok: true,
          status: 201,
          // Omit the optional id so the write-once link remains visible while this test isolates
          // the clipboard completion race rather than authoritative invite-list reconciliation.
          json: async () => ({ token: 'ACCOUNT_A_TOKEN' }),
        } as Response
      }
      throw new Error(`Unexpected request: ${target}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderSection()
    await screen.findByTestId('members-section')

    fireEvent.click(screen.getByTestId('invite-submit'))
    expect(await screen.findByTestId('invite-link')).toBeInTheDocument()
    act(() => useStore.getState().setNotice(null))
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledOnce()

    act(() => useStore.setState({ activeAccountId: nextAccountId }))
    expect(await screen.findByText('second@example.test')).toBeInTheDocument()
    await act(async () => finishCopy?.())

    expect(useStore.getState().notice?.message ?? '').not.toMatch(/copied/i)
  })

  it('keeps the last authoritative invite list when a same-account invite reload fails', async () => {
    const existingInvite = {
      id: 'inv-existing',
      role: 'viewer',
      preauthEmail: 'existing@example.test',
      expiresAt: '2026-12-01T00:00:00.000Z',
      usedAt: null,
      createdAt: '2026-07-17T00:00:00.000Z',
    }
    let invitationReads = 0
    const reads = mockFetch([{ userId: 'me', role: 'owner', isSelf: true }])
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url)
      const isRead = !init || init.method === undefined || init.method === 'GET'
      if (target.endsWith('/invites') && isRead) {
        invitationReads += 1
        return invitationReads === 1
          ? { ok: true, status: 200, json: async () => ({ invites: [existingInvite] }) } as Response
          : { ok: false, status: 503, json: async () => ({ error: 'Invite reload failed.' }) } as Response
      }
      if (target.endsWith('/api/invites') && init?.method === 'POST') {
        return {
          ok: true,
          status: 201,
          json: async () => ({ id: 'inv-new', token: 'TOK123' }),
        } as Response
      }
      return reads(url, init)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderSection()
    expect(await screen.findByText(/existing@example\.test/)).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('invite-submit'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invite reload failed.')
    expect(screen.getByText(/existing@example\.test/)).toBeInTheDocument()
  })

  it('ignores a late unknown mutation outcome after the user has switched accounts', async () => {
    const nextAccountId = 'acc_second'
    let resolveCreate: ((response: Response) => void) | undefined
    const fetchMock = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
      const target = String(url)
      const isRead = !init || init.method === undefined || init.method === 'GET'
      if (target.endsWith('/members') && isRead) {
        const second = target.includes(`/${nextAccountId}/`)
        return {
          ok: true,
          status: 200,
          json: async () => ({
            members: [{
              userId: second ? 'second-owner' : 'me',
              role: 'owner',
              status: 'active',
              createdAt: '2026-01-01T00:00:00.000Z',
              name: null,
              email: second ? 'second@example.test' : 'me@x.io',
              isSelf: true,
              mayResetPassword: false,
              mayRevokeSessions: false,
            }],
          }),
        } as Response
      }
      if (target.endsWith('/invites') && isRead) {
        return { ok: true, status: 200, json: async () => ({ invites: [] }) } as Response
      }
      if (target.endsWith('/api/invites') && init?.method === 'POST') {
        return await new Promise<Response>((resolve) => {
          resolveCreate = resolve
        })
      }
      throw new Error(`Unexpected request: ${target}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderSection()
    await screen.findByTestId('members-section')

    fireEvent.click(screen.getByTestId('invite-submit'))
    await waitFor(() => expect(resolveCreate).toBeTypeOf('function'))
    act(() => useStore.setState({ activeAccountId: nextAccountId }))
    expect(await screen.findByText('second@example.test')).toBeInTheDocument()

    await act(async () => {
      resolveCreate?.({
        ok: false,
        status: 503,
        json: async () => ({ error: 'The first account outcome is unknown.' }),
      } as Response)
    })

    expect(screen.getByText('second@example.test')).toBeInTheDocument()
    expect(screen.queryByText(/first account outcome is unknown/i)).not.toBeInTheDocument()
    expect(useStore.getState().notice?.message ?? '').not.toMatch(/unknown outcome/i)
  })

  it('removes the write-once link when its invite is revoked', async () => {
    const user = userEvent.setup()
    const invite = {
      id: 'inv-new',
      role: 'editor',
      preauthEmail: null,
      expiresAt: '2026-12-01T00:00:00.000Z',
      usedAt: null,
      createdAt: '2026-07-17T00:00:00.000Z',
    }
    let invites: typeof invite[] = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.endsWith('/members')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            members: [{
              userId: 'me',
              role: 'owner',
              status: 'active',
              createdAt: '2026-01-01T00:00:00.000Z',
              name: null,
              email: 'me@x.io',
              isSelf: true,
              mayResetPassword: false,
              mayRevokeSessions: false,
            }],
          }),
        } as unknown as Response
      }
      if (u.endsWith('/api/invites') && init?.method === 'POST') {
        invites = [invite]
        return { ok: true, status: 201, json: async () => ({ id: invite.id, token: 'TOK123', role: invite.role }) } as unknown as Response
      }
      if (u.endsWith(`/invites/${invite.id}`) && init?.method === 'DELETE') {
        invites = []
        return { ok: true, status: 204, json: async () => ({}) } as unknown as Response
      }
      if (u.endsWith('/invites') && (!init || init.method === 'GET' || init.method === undefined)) {
        return { ok: true, status: 200, json: async () => ({ invites }) } as unknown as Response
      }
      return { ok: true, status: 204, json: async () => ({}) } as unknown as Response
    })
    vi.stubGlobal('fetch', fetchMock)
    renderSection()
    await screen.findByTestId('members-section')

    await user.click(screen.getByTestId('invite-submit'))
    expect(await screen.findByTestId('invite-link')).toHaveTextContent('/invite/TOK123')
    await user.click(await screen.findByTestId('invite-revoke'))

    await waitFor(() => expect(screen.queryByTestId('invite-link')).not.toBeInTheDocument())
  })

  it('refuses a malformed token response instead of constructing an undefined link', async () => {
    const reads = mockFetch([{ userId: 'me', role: 'owner', isSelf: true }])
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/api/invites') && init?.method === 'POST') {
        return { ok: true, status: 201, json: async () => ({ role: 'editor' }) } as unknown as Response
      }
      return reads(url, init)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderSection()
    await screen.findByTestId('members-section')

    fireEvent.click(screen.getByTestId('invite-submit'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/one-time link was lost|unknown invite/i)
    expect(screen.queryByTestId('invite-link')).not.toBeInTheDocument()
  })
})

// Reference DEFAULT_ACCOUNT_ID so the fixture import is used (the URL the component builds).
it('uses the active account id from the store in fetch URLs', async () => {
  const fetchMock = mockFetch([{ userId: 'me', role: 'owner', isSelf: true }])
  vi.stubGlobal('fetch', fetchMock)
  renderSection()
  await screen.findByTestId('members-section')
  expect(fetchMock).toHaveBeenCalledWith(
    `http://api.test/api/accounts/${DEFAULT_ACCOUNT_ID}/members`,
    expect.objectContaining({ credentials: 'include' }),
  )
})
