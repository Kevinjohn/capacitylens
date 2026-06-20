import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { AppShell } from '../AppShell'
import { AccountPicker } from './AccountPicker'
import { useStore } from '../../store/useStore'
import { emptyAppData } from '@floaty/shared/types/entities'
import { makeAccount, makeAppData, DEFAULT_ACCOUNT_ID } from '../../test/fixtures'

beforeEach(() => {
  useStore.getState().replaceAll(emptyAppData())
  useStore.getState().setActiveAccount(null)
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
    useStore.getState().replaceAll(makeAppData({ accounts: [makeAccount({ name: 'Studio North' })] }))
    renderShell()
    expect(screen.getByText('Choose a company')).toBeInTheDocument()
    expect(screen.getByText('Studio North')).toBeInTheDocument()
    // The main nav is gated away until a company is chosen.
    expect(screen.queryByRole('link', { name: 'Schedule' })).not.toBeInTheDocument()
  })

  it('shows the shell (with the active company + Switch company) once an account is active', () => {
    useStore.getState().replaceAll(makeAppData({ accounts: [makeAccount({ name: 'Studio North' })] }))
    useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID)
    renderShell()
    expect(screen.queryByText('Choose a company')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Schedule' })).toBeInTheDocument()
    expect(screen.getByText('Studio North')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Switch company' })).toBeInTheDocument()
  })

  it('"Switch company" returns to the picker', async () => {
    const user = userEvent.setup()
    useStore.getState().replaceAll(makeAppData({ accounts: [makeAccount({ name: 'Studio North' })] }))
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
    useStore.getState().replaceAll(makeAppData({ accounts: [makeAccount({ name: 'Studio North' })] }))
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
    useStore.getState().replaceAll(makeAppData({ accounts: [makeAccount({ name: 'Studio North' })] }))
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
