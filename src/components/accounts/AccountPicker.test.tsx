import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { AppShell } from '../AppShell'
import { AccountPicker } from './AccountPicker'
import { AuthContext } from '../../auth/authContext'
import { useStore } from '../../store/useStore'
import { emptyAppData } from '@capacitylens/shared/types/entities'
import { makeAccount, makeAppData, DEFAULT_ACCOUNT_ID } from '../../test/fixtures'

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

beforeEach(() => {
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

describe('AccountPicker — single-company-per-instance policy (canCreateAccount)', () => {
  it('hides the "New company" button when the auth context reports the cap is reached', () => {
    seedAccounts(makeAccount({ name: 'Studio North' }))
    withCanCreateAccount(false, <AccountPicker />)
    expect(screen.queryByTestId('new-company-button')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New company' })).not.toBeInTheDocument()
  })

  it('shows the "New company" button when the auth context allows another company', () => {
    seedAccounts(makeAccount({ name: 'Studio North' }))
    withCanCreateAccount(true, <AccountPicker />)
    expect(screen.getByTestId('new-company-button')).toBeInTheDocument()
  })

  it('REGRESSION GUARD: no AuthContext provider (demo build / older callers) fails OPEN — button stays visible', () => {
    seedAccounts(makeAccount({ name: 'Studio North' }))
    render(<AccountPicker />)
    expect(screen.getByTestId('new-company-button')).toBeInTheDocument()
  })
})
