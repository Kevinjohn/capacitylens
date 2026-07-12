import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { AppShell } from '../AppShell'
import { AccountPicker } from './AccountPicker'
import { AuthContext } from '../../auth/authContext'
import { useStore } from '../../store/useStore'
import { emptyAppData } from '@capacitylens/shared/types/entities'
import { makeAccount, makeAppData, DEFAULT_ACCOUNT_ID } from '../../test/fixtures'

// The picker now branches server-vs-demo (create → POST /api/orgs; delete → DELETE /api/accounts/:id
// in server mode), so apiConfig is mocked with a MUTABLE flag — the ArchivedSection.test idiom: most
// tests run as the demo build (local store paths), the server-mode describe flips it on per-test.
const serverFlag = vi.hoisted(() => ({ on: false }))
vi.mock('../../data/apiConfig', () => ({
  API_BASE: '',
  isDemoMode: () => !serverFlag.on,
  isServerConfigured: () => serverFlag.on,
}))

/** Render `ui` inside an AuthContext fixed to `canCreateAccount` (single-company-per-instance
 *  policy) — mirrors permissionGating.test.tsx's `withRole`. The other fields are fixed to the
 *  same defaults the real context uses when the fact IS available (authMode off, no user). */
function withCanCreateAccount(canCreateAccount: boolean, ui: ReactNode) {
  return render(
    <AuthContext.Provider
      value={{ authMode: 'off', user: null, canCreateAccount, multiAccount: canCreateAccount, signOut: async () => {} }}
    >
      {ui}
    </AuthContext.Provider>,
  )
}

/** Seed the picker's server-sourced list (P1.13) from the store's accounts — mirrors the demo build's
 *  derivation (useAccountSummaries), which these unit tests don't mount. The picker now lists from
 *  accountSummaries, NOT data.accounts, so any test that seeds accounts must seed summaries too. */
function seedAccounts(...accounts: ReturnType<typeof makeAccount>[]) {
  useStore.getState().replaceAll(makeAppData({ accounts }))
  useStore.getState().setAccountSummaries(accounts.map((a) => ({ id: a.id, name: a.name, role: 'owner' as const })))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  serverFlag.on = false
  useStore.getState().replaceAll(emptyAppData())
  useStore.getState().setActiveAccount(null)
  useStore.getState().setAccountSummaries([])
  useStore.getState().setHydrated(true)
  // Sign through the cosmetic demo gate so AppShell renders the picker (the demo sign-in
  // sits in front of it) — these tests exercise the account gate, not the demo one.
  useStore.getState().setFakeSignedIn(true)
  // Dismiss the post-login intro page too: it gates the app AFTER a company is chosen, and
  // these tests assert on the picker / shell, not the intro (covered by IntroPage.test.tsx).
  useStore.getState().setIntroSeen(true)
})

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AppShell />
    </MemoryRouter>,
  )
}

describe('AppShell account gate', () => {
  it('shows the AccountPicker (not the nav) when hydrated with no active account', () => {
    seedAccounts(makeAccount({ name: 'Studio North' }))
    renderShell()
    expect(screen.getByText('Choose a company')).toBeInTheDocument()
    expect(screen.getByText('Studio North')).toBeInTheDocument()
    // The main nav is gated away until a company is chosen.
    expect(screen.queryByRole('link', { name: 'Schedule' })).not.toBeInTheDocument()
  })

  it('shows the shell (with the active company + Switch company) once an account is active', () => {
    seedAccounts(makeAccount({ name: 'Studio North' }))
    useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID)
    renderShell()
    expect(screen.queryByText('Choose a company')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Schedule' })).toBeInTheDocument()
    expect(screen.getByText('Studio North')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Switch company' })).toBeInTheDocument()
  })

  it('"Switch company" returns to the picker', async () => {
    const user = userEvent.setup()
    seedAccounts(makeAccount({ name: 'Studio North' }))
    useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID)
    renderShell()
    await user.click(screen.getByRole('button', { name: 'Switch company' }))
    expect(screen.getByText('Choose a company')).toBeInTheDocument()
    expect(useStore.getState().activeAccountId).toBeNull()
  })
})

describe('AccountPicker create + open + delete', () => {
  it('creates a company inline and activates it', async () => {
    const user = userEvent.setup()
    render(<AccountPicker />)

    await user.click(screen.getByRole('button', { name: 'New company' }))
    const nameInput = screen.getByLabelText('Company name')
    await user.type(nameInput, 'Loft Digital')
    await user.click(screen.getByRole('button', { name: 'Create company' }))

    expect(useStore.getState().data.accounts.map((a) => a.name)).toContain('Loft Digital')
    // Creating activates it.
    const created = useStore.getState().data.accounts.find((a) => a.name === 'Loft Digital')!
    expect(useStore.getState().activeAccountId).toBe(created.id)
  })

  it('captures week-start, timezone and language at creation and passes them to addAccount (P1.14)', async () => {
    const user = userEvent.setup()
    render(<AccountPicker />)

    await user.click(screen.getByRole('button', { name: 'New company' }))
    // The three frozen-after-creation fields render with concrete defaults.
    expect(screen.getByRole('radio', { name: 'Monday' })).toHaveAttribute('aria-checked', 'true')
    const tz = screen.getByLabelText('Timezone') as HTMLSelectElement
    expect(tz.value).toBe('Etc/GMT')
    expect(screen.getByTestId('create-language')).toHaveTextContent('English')

    // Change the two editable-at-creation ones, then create.
    await user.click(screen.getByRole('radio', { name: 'Sunday' }))
    await user.selectOptions(tz, 'Europe/London')
    await user.type(screen.getByLabelText('Company name'), 'Frozen Co')
    await user.click(screen.getByRole('button', { name: 'Create company' }))

    const created = useStore.getState().data.accounts.find((a) => a.name === 'Frozen Co')!
    expect(created.weekStartsOn).toBe(0)
    expect(created.timezone).toBe('Europe/London')
    expect(created.language).toBe('en')
  })

  it('validates a blank name', async () => {
    const user = userEvent.setup()
    render(<AccountPicker />)
    await user.click(screen.getByRole('button', { name: 'New company' }))
    await user.click(screen.getByRole('button', { name: 'Create company' }))
    expect(screen.getByText('Name is required.')).toBeInTheDocument()
    expect(useStore.getState().data.accounts).toHaveLength(0)
  })

  it('opens an existing company by clicking it', async () => {
    const user = userEvent.setup()
    seedAccounts(makeAccount({ name: 'Studio North' }))
    render(<AccountPicker />)
    await user.click(screen.getByRole('button', { name: 'Studio North' }))
    expect(useStore.getState().activeAccountId).toBe(DEFAULT_ACCOUNT_ID)
  })

  it('creates a company when pressing Enter in the company name input', async () => {
    const user = userEvent.setup()
    render(<AccountPicker />)

    await user.click(screen.getByRole('button', { name: 'New company' }))
    await user.type(screen.getByLabelText('Company name'), 'Enter Co')
    await user.keyboard('{Enter}')

    expect(useStore.getState().data.accounts.map((a) => a.name)).toContain('Enter Co')
    const created = useStore.getState().data.accounts.find((a) => a.name === 'Enter Co')!
    expect(useStore.getState().activeAccountId).toBe(created.id)
  })

  it('deletes a company only after typing its name to confirm', async () => {
    const user = userEvent.setup()
    seedAccounts(makeAccount({ name: 'Studio North' }))
    render(<AccountPicker />)

    await user.click(screen.getByRole('button', { name: 'Delete Studio North' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(/Delete company\?/i)

    // Friction on the one irreversible action: Delete is armed only once the exact
    // name is typed.
    const deleteBtn = within(dialog).getByRole('button', { name: 'Delete' })
    expect(deleteBtn).toBeDisabled()
    await user.type(within(dialog).getByLabelText(/Type/i), 'Studio North')
    expect(deleteBtn).toBeEnabled()
    await user.click(deleteBtn)

    expect(useStore.getState().data.accounts).toHaveLength(0)
  })
})

describe('AccountPicker server-mode list (P1.13)', () => {
  it('lists from accountSummaries, NOT data.accounts (server mode holds only the active slice in data)', () => {
    // Simulate server mode: `data` holds only ONE account (the active slice would, post-load), but the
    // login has TWO memberships in accountSummaries. The picker must show BOTH from the summaries.
    useStore.getState().replaceAll(makeAppData({ accounts: [makeAccount({ id: 'a1', name: 'Active Co' })] }))
    useStore.getState().setAccountSummaries([
      { id: 'a1', name: 'Active Co', role: 'owner' },
      { id: 'a2', name: 'Other Co', role: 'editor' }, // NOT in data.accounts
    ])
    render(<AccountPicker />)
    expect(screen.getByText('Active Co')).toBeInTheDocument()
    expect(screen.getByText('Other Co')).toBeInTheDocument() // proves the source is summaries, not data
  })

  it('activates an account whose slice is NOT loaded (existence via summaries)', async () => {
    const user = userEvent.setup()
    // `data` is empty (no slice loaded yet — the pre-load state), but the summary exists.
    useStore.getState().replaceAll(emptyAppData())
    useStore.getState().setAccountSummaries([{ id: 'a2', name: 'Other Co', role: 'editor' }])
    render(<AccountPicker />)
    await user.click(screen.getByRole('button', { name: 'Other Co' }))
    // setActiveAccount validates against the UNION of data.accounts + summaries, so it activates
    // (the switch orchestrator then hydrates the slice) rather than bouncing back to the picker.
    expect(useStore.getState().activeAccountId).toBe('a2')
  })

  it('shows the no-accounts help state when summaries are empty, AND the New company button (bootstrap exemption)', () => {
    useStore.getState().replaceAll(emptyAppData())
    useStore.getState().setAccountSummaries([])
    render(<AccountPicker />)
    expect(screen.getByText(/No companies yet/)).toBeInTheDocument()
    expect(screen.getByText(/ask an admin for an invite/)).toBeInTheDocument()
    // Zero accounts ⇒ the server always reports canCreateAccount: true (no provider here, so the
    // default context value applies — see authContext.ts's fail-open default).
    expect(screen.getByTestId('new-company-button')).toBeInTheDocument()
  })
})

describe('AccountPicker server-mode create/delete (P1.13 client migration)', () => {
  /** A fetch stub returning `response` for every call; records (url, init) pairs. */
  function stubFetch(response: { ok: boolean; status: number; body?: unknown }) {
    const fetchMock = vi.fn(async () => ({
      ok: response.ok,
      status: response.status,
      json: async () => response.body ?? {},
    }))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('creates via POST /api/orgs (the atomic org path — NOT the local addAccount), seeds the summary, activates', async () => {
    serverFlag.on = true
    const user = userEvent.setup()
    const fetchMock = stubFetch({ ok: true, status: 201, body: { id: 'org-1', name: 'Loft Digital' } })
    render(<AccountPicker />)

    await user.click(screen.getByRole('button', { name: 'New company' }))
    await user.type(screen.getByLabelText('Company name'), 'Loft Digital')
    await user.click(screen.getByRole('button', { name: 'Create company' }))

    await waitFor(() => expect(useStore.getState().activeAccountId).toBe('org-1'))
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/orgs')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    // The three frozen fields ride in the body as concrete values (P1.14).
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.name).toBe('Loft Digital')
    expect(body.weekStartsOn).toBe(1)
    expect(body.timezone).toBe('Etc/GMT')
    // Summary seeded (the picker lists it; setActiveAccount validated against it)…
    expect(useStore.getState().accountSummaries.map((a) => a.id)).toContain('org-1')
    // …and NO local addAccount ran (the slice arrives via the switch orchestrator's loadAll, not here).
    expect(useStore.getState().data.accounts).toHaveLength(0)
  })

  it('on a 2xx create with an unusable body: NO error, form closes, list refetched, nothing activated', async () => {
    // A 2xx means the org EXISTS server-side. An unreadable/off-spec body must therefore NOT surface
    // an error over a create that succeeded (a resubmit would duplicate / trip the cap-403), and must
    // NOT seed a bogus {id: undefined} summary that setActiveAccount would then accept. Instead: the
    // form closes and the authoritative /api/accounts refetch lists the new company.
    serverFlag.on = true
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/orgs') return { ok: true, status: 201, json: async () => ({ ok: true }) } // no id/name
      return { ok: true, status: 200, json: async () => [{ id: 'org-9', name: 'Loft Digital', role: 'owner' }] }
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<AccountPicker />)

    await user.click(screen.getByRole('button', { name: 'New company' }))
    await user.type(screen.getByLabelText('Company name'), 'Loft Digital')
    await user.click(screen.getByRole('button', { name: 'Create company' }))

    // The company appears via the refetch (the picker list), the form is gone, and no error shows.
    expect(await screen.findByText('Loft Digital')).toBeInTheDocument()
    expect(screen.queryByLabelText('Company name')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.map((c) => c[0] as unknown as string)).toContain('/api/accounts')
    // No activation: the create response carried no trustworthy id.
    expect(useStore.getState().activeAccountId).toBeNull()
    expect(useStore.getState().accountSummaries.map((a) => a.id)).toEqual(['org-9'])
  })

  it('surfaces the server refusal (cap / org gate) as the form error and does NOT activate', async () => {
    serverFlag.on = true
    const user = userEvent.setup()
    stubFetch({ ok: false, status: 403, body: { error: 'This instance allows a single company.' } })
    render(<AccountPicker />)

    await user.click(screen.getByRole('button', { name: 'New company' }))
    await user.type(screen.getByLabelText('Company name'), 'Second Co')
    await user.click(screen.getByRole('button', { name: 'Create company' }))

    expect(await screen.findByText('This instance allows a single company.')).toBeInTheDocument()
    expect(useStore.getState().activeAccountId).toBeNull()
    expect(useStore.getState().accountSummaries).toHaveLength(0)
  })

  it('deletes an UNLOADED company via DELETE /api/accounts/:id and drops its summary', async () => {
    // The regression this guards: the local deleteAccount cascade diffs the LOADED slice only, so a
    // company whose slice isn't in `data` would emit no ops, delete nothing server-side, and
    // resurrect on the next summaries refetch. Server mode must call the dedicated route instead.
    serverFlag.on = true
    const user = userEvent.setup()
    const fetchMock = stubFetch({ ok: true, status: 204 })
    useStore.getState().setAccountSummaries([{ id: 'a9', name: 'Ghost Co', role: 'owner' }]) // slice NOT loaded
    render(<AccountPicker />)

    await user.click(screen.getByRole('button', { name: 'Delete Ghost Co' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Type/i), 'Ghost Co')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(useStore.getState().accountSummaries).toHaveLength(0))
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/accounts/a9')
    expect(init.method).toBe('DELETE')
  })

  it('disarms Delete while the DELETE is in flight (double-click sends ONE request)', async () => {
    // The regression this guards: without the in-flight guard a double-click sends a second DELETE,
    // which 403s in auth-on mode (the membership was erased by the first) → a spurious "Forbidden."
    // toast right after a successful delete.
    serverFlag.on = true
    const user = userEvent.setup()
    let resolveDelete!: (v: { ok: boolean; status: number; json: () => Promise<unknown> }) => void
    const fetchMock = vi.fn(() => new Promise((resolve) => { resolveDelete = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    useStore.getState().setAccountSummaries([{ id: 'a9', name: 'Ghost Co', role: 'owner' }])
    render(<AccountPicker />)

    await user.click(screen.getByRole('button', { name: 'Delete Ghost Co' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Type/i), 'Ghost Co')
    const deleteBtn = within(dialog).getByRole('button', { name: 'Delete' })
    await user.click(deleteBtn)

    // In flight: the busy prop disarms the button; a second click must not send a second DELETE.
    expect(deleteBtn).toBeDisabled()
    await user.click(deleteBtn)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveDelete({ ok: true, status: 204, json: async () => ({}) })
    await waitFor(() => expect(useStore.getState().accountSummaries).toHaveLength(0))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(useStore.getState().notice).toBeNull() // no spurious error after a successful delete
  })

  it('keeps the company listed and surfaces a notice when the server refuses the delete', async () => {
    serverFlag.on = true
    const user = userEvent.setup()
    stubFetch({ ok: false, status: 403, body: { error: 'Forbidden.' } })
    useStore.getState().setAccountSummaries([{ id: 'a9', name: 'Ghost Co', role: 'owner' }])
    render(<AccountPicker />)

    await user.click(screen.getByRole('button', { name: 'Delete Ghost Co' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Type/i), 'Ghost Co')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(useStore.getState().notice?.message).toBe('Forbidden.'))
    expect(useStore.getState().accountSummaries).toHaveLength(1) // nothing removed optimistically
  })

  it("offers NO Delete button on a viewer/editor summary (company deletion is 'purge'-tier, admin+)", () => {
    useStore.getState().setAccountSummaries([
      { id: 'a1', name: 'Owner Co', role: 'owner' },
      { id: 'a2', name: 'Editor Co', role: 'editor' },
      { id: 'a3', name: 'Viewer Co', role: 'viewer' },
    ])
    render(<AccountPicker />)
    expect(screen.getByRole('button', { name: 'Delete Owner Co' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete Editor Co' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete Viewer Co' })).not.toBeInTheDocument()
  })
})

describe('AccountPicker — single-company-per-instance policy (canCreateAccount)', () => {
  it('hides the "New company" button when the auth context reports the cap is reached', () => {
    seedAccounts(makeAccount({ name: 'Studio North' }))
    withCanCreateAccount(false, <AccountPicker />)
    expect(screen.queryByTestId('new-company-button')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New company' })).not.toBeInTheDocument()
    // The subtitle must not promise a create affordance that isn't rendered.
    expect(screen.getByText('Pick a company to plan.')).toBeInTheDocument()
    expect(screen.queryByText('Pick a company to plan, or create a new one.')).not.toBeInTheDocument()
  })

  it('shows the "New company" button when the auth context allows another company', () => {
    seedAccounts(makeAccount({ name: 'Studio North' }))
    withCanCreateAccount(true, <AccountPicker />)
    expect(screen.getByTestId('new-company-button')).toBeInTheDocument()
    expect(screen.getByText('Pick a company to plan, or create a new one.')).toBeInTheDocument()
  })

  it('REGRESSION GUARD: no AuthContext provider (demo build / older callers) fails OPEN — button stays visible', () => {
    seedAccounts(makeAccount({ name: 'Studio North' }))
    render(<AccountPicker />)
    expect(screen.getByTestId('new-company-button')).toBeInTheDocument()
  })
})
