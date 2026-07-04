import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MembersSection } from './MembersSection'
import { AuthContext, type AuthContextValue } from '../../auth/authContext'
import { resetStoreWithAccount, DEFAULT_ACCOUNT_ID } from '../../test/fixtures'

// MembersSection is the Settings → Members UI (P1.11). It renders ONLY in auth-on + server mode and
// self-gates via a 403 on the members read. These tests mock apiConfig (so isServerConfigured() is
// true) and fetch, and assert the OWNER-ONLY affordances are hidden for an admin (no owner option, no
// controls on an owner row), the sole-owner row is protected (disabled), and a 403 renders nothing.

// Make the section "enabled": a configured server. The real module reads import.meta.env, which the
// test env leaves unset; mocking it is the clean way to flip server mode on.
vi.mock('../../data/apiConfig', () => ({
  API_BASE: 'http://api.test',
  isServerConfigured: () => true,
}))

interface RawMember {
  userId: string
  role: 'owner' | 'admin' | 'editor' | 'viewer'
  status?: string
  createdAt?: string
  name?: string | null
  email?: string | null
  isSelf?: boolean
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
            ...m,
          })),
        }),
      } as unknown as Response
    }
    if (u.endsWith('/invites') && (!init || init.method === undefined || init.method === 'GET')) {
      return { ok: true, status: 200, json: async () => ({ invites: [] }) } as unknown as Response
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
  signOut: async () => {},
  ...over,
})

function renderSection() {
  return render(
    <AuthContext.Provider value={authValue()}>
      <MembersSection />
    </AuthContext.Provider>,
  )
}

beforeEach(() => {
  resetStoreWithAccount() // sets activeAccountId = DEFAULT_ACCOUNT_ID
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('MembersSection — self-gate', () => {
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

    const invitePicker = screen.getByTestId('invite-role') as HTMLSelectElement
    const optionValues = Array.from(invitePicker.options).map((o) => o.value)
    expect(optionValues).toContain('admin')
    expect(optionValues).toContain('editor')
    expect(optionValues).not.toContain('owner') // admin may never offer/grant owner
  })

  it('shows no role control + no Remove on an OWNER row (admin can\'t touch an owner)', async () => {
    vi.stubGlobal('fetch', mockFetch(members))
    renderSection()
    await screen.findByTestId('members-section')

    const rows = screen.getAllByTestId('member-row')
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
})

describe('MembersSection — owner affordances', () => {
  it('offers the owner option and controls on every row for an owner', async () => {
    const members: RawMember[] = [
      { userId: 'me', role: 'owner', isSelf: true },
      { userId: 'other', role: 'owner' }, // a SECOND owner, so neither is the sole owner
      { userId: 'ed', role: 'editor' },
    ]
    vi.stubGlobal('fetch', mockFetch(members))
    renderSection()
    await screen.findByTestId('members-section')

    const invitePicker = screen.getByTestId('invite-role') as HTMLSelectElement
    expect(Array.from(invitePicker.options).map((o) => o.value)).toContain('owner')

    // The other owner row is manageable (two owners → not sole) — it has a role control + Remove.
    const rows = screen.getAllByTestId('member-row')
    const otherOwnerRow = rows.find((r) => within(r).queryByText(/other@x\.io/))!
    expect(within(otherOwnerRow).getByRole('combobox')).toBeInTheDocument()
    expect(within(otherOwnerRow).getByTestId('member-remove')).toBeInTheDocument()
  })

  it('protects the SOLE owner — its role control is disabled and Remove is hidden', async () => {
    const members: RawMember[] = [
      { userId: 'me', role: 'owner', isSelf: true }, // the only owner
      { userId: 'ed', role: 'editor' },
    ]
    vi.stubGlobal('fetch', mockFetch(members))
    renderSection()
    await screen.findByTestId('members-section')

    const rows = screen.getAllByTestId('member-row')
    const soleOwnerRow = rows.find((r) => within(r).queryByText(/me@x\.io/))!
    expect(within(soleOwnerRow).getByText(/Sole owner — protected/)).toBeInTheDocument()
    expect(within(soleOwnerRow).getByRole('combobox')).toBeDisabled()
    expect(within(soleOwnerRow).queryByTestId('member-remove')).not.toBeInTheDocument()
  })
})

describe('MembersSection — transfer ownership (Make owner)', () => {
  it('an owner sees "Make owner" ONLY on non-self, non-owner rows', async () => {
    const members: RawMember[] = [
      { userId: 'me', role: 'owner', isSelf: true },
      { userId: 'other', role: 'owner' }, // a second owner
      { userId: 'ed', role: 'editor' },
    ]
    vi.stubGlobal('fetch', mockFetch(members))
    renderSection()
    await screen.findByTestId('members-section')

    const rows = screen.getAllByTestId('member-row')
    const selfRow = rows.find((r) => within(r).queryByText(/me@x\.io/))!
    const ownerRow = rows.find((r) => within(r).queryByText(/other@x\.io/))!
    const edRow = rows.find((r) => within(r).queryByText(/ed@x\.io/))!
    // The atomic hand-over is offered on an eligible target (editor), not on the caller, not on
    // another owner (that would be a no-op / meaningless).
    expect(within(edRow).getByTestId('member-make-owner')).toBeInTheDocument()
    expect(within(selfRow).queryByTestId('member-make-owner')).not.toBeInTheDocument()
    expect(within(ownerRow).queryByTestId('member-make-owner')).not.toBeInTheDocument()
  })

  it('an admin NEVER sees "Make owner" (owner-only affordance)', async () => {
    const members: RawMember[] = [
      { userId: 'me', role: 'admin', isSelf: true },
      { userId: 'ed', role: 'editor' },
    ]
    vi.stubGlobal('fetch', mockFetch(members))
    renderSection()
    await screen.findByTestId('members-section')
    expect(screen.queryByTestId('member-make-owner')).not.toBeInTheDocument()
  })

  it('clicking "Make owner" POSTs the transfer for that member', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch([
      { userId: 'me', role: 'owner', isSelf: true },
      { userId: 'ed', role: 'editor' },
    ])
    vi.stubGlobal('fetch', fetchMock)
    renderSection()
    await screen.findByTestId('members-section')

    const edRow = screen.getAllByTestId('member-row').find((r) => within(r).queryByText(/ed@x\.io/))!
    await user.click(within(edRow).getByTestId('member-make-owner'))
    expect(fetchMock).toHaveBeenCalledWith(
      `http://api.test/api/accounts/${DEFAULT_ACCOUNT_ID}/transfer-ownership`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ toUserId: 'ed' }) }),
    )
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
              { userId: 'me', role: 'owner', status: 'active', createdAt: 'x', name: null, email: 'me@x.io', isSelf: true },
              { userId: 'ed', role: 'editor', status: 'active', createdAt: 'x', name: null, email: 'ed@x.io', isSelf: false },
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

    const edRow = screen.getAllByTestId('member-row').find((r) => within(r).queryByText(/ed@x\.io/))!
    await user.click(within(edRow).getByTestId('member-make-owner'))
    // The server's own message is preferred over the generic fallback (body.error ?? …).
    expect(await screen.findByText('Only the owner can transfer ownership.')).toBeInTheDocument()
  })
})

describe('MembersSection — invite mint', () => {
  it('shows the invite link ONCE on a 201, built from the returned token', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.endsWith('/members')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            members: [{ userId: 'me', role: 'owner', status: 'active', createdAt: 'x', name: null, email: 'me@x.io', isSelf: true }],
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
