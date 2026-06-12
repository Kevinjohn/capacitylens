import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsView } from './SettingsView'
import { AuthContext } from '../../auth/authContext'
import { useStore } from '../../store/useStore'
import { resetStoreWithAccount, DEFAULT_ACCOUNT_ID } from '../../test/fixtures'

beforeEach(() => {
  resetStoreWithAccount()
  useStore.getState().setTheme('light')
})

describe('SettingsView — company name', () => {
  it('renames the active account through the store', async () => {
    const user = userEvent.setup()
    render(<SettingsView />)

    const input = screen.getByLabelText('Company name')
    expect(input).toHaveValue('Test Co')

    // No edit yet → Save is disabled.
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    await user.clear(input)
    await user.type(input, 'Renamed Co')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    const account = useStore.getState().data.accounts.find((a) => a.id === DEFAULT_ACCOUNT_ID)
    expect(account?.name).toBe('Renamed Co')
    expect(useStore.getState().notice?.message).toMatch(/updated/i)
  })

  it('re-syncs the field when the account name changes underneath (e.g. undo)', async () => {
    const user = userEvent.setup()
    render(<SettingsView />)

    const input = screen.getByLabelText('Company name')
    await user.clear(input)
    await user.type(input, 'Acme')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(input).toHaveValue('Acme')

    // Undo reverts the store name; the field must follow it, not stay stale on 'Acme'.
    act(() => useStore.getState().undo())
    expect(input).toHaveValue('Test Co')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('rejects an empty name with a field error', async () => {
    const user = userEvent.setup()
    render(<SettingsView />)

    const input = screen.getByLabelText('Company name')
    await user.clear(input)
    await user.type(input, '   ')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/name is required/i)
    expect(useStore.getState().data.accounts[0].name).toBe('Test Co')
  })
})

describe('SettingsView — scheduling mode', () => {
  it('defaults to Hours and switches the company to Days through the store', async () => {
    const user = userEvent.setup()
    render(<SettingsView />)

    const hours = screen.getByRole('radio', { name: 'Hours' })
    const days = screen.getByRole('radio', { name: 'Days' })
    // Absent schedulingMode reads as the original 'hourly' behaviour.
    expect(hours).toHaveAttribute('aria-checked', 'true')
    expect(days).toHaveAttribute('aria-checked', 'false')

    await user.click(days)

    const account = useStore.getState().data.accounts.find((a) => a.id === DEFAULT_ACCOUNT_ID)
    expect(account?.schedulingMode).toBe('days')
    expect(days).toHaveAttribute('aria-checked', 'true')
  })

  it('offers a Blocks option and switches the company to it', async () => {
    const user = userEvent.setup()
    render(<SettingsView />)

    const blocks = screen.getByRole('radio', { name: 'Blocks' })
    expect(blocks).toHaveAttribute('aria-checked', 'false')

    await user.click(blocks)

    const account = useStore.getState().data.accounts.find((a) => a.id === DEFAULT_ACCOUNT_ID)
    expect(account?.schedulingMode).toBe('blocks')
    expect(blocks).toHaveAttribute('aria-checked', 'true')
  })
})

describe('SettingsView — theme', () => {
  it('reflects the current preference and switches it on click', async () => {
    const user = userEvent.setup()
    render(<SettingsView />)

    const light = screen.getByRole('radio', { name: 'Light' })
    const dark = screen.getByRole('radio', { name: 'Dark' })
    expect(light).toHaveAttribute('aria-checked', 'true')
    expect(dark).toHaveAttribute('aria-checked', 'false')

    await user.click(dark)

    expect(useStore.getState().theme).toBe('dark')
    expect(dark).toHaveAttribute('aria-checked', 'true')
    // The choice is reflected onto <html> for the CSS to key off.
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})

describe('SettingsView — build stamp', () => {
  // buildStamp() reads the env at render time, so stubbing before render is enough here
  // (the server/local suffix is exercised in buildInfo.test.ts, where modules are reset).
  afterEach(() => vi.unstubAllEnvs())

  it('renders nothing when VITE_FLOATY_BUILD_SHA is unset (today\'s Settings)', () => {
    render(<SettingsView />)
    expect(screen.queryByTestId('build-stamp')).not.toBeInTheDocument()
  })

  it('renders the muted footer when the build is stamped', () => {
    vi.stubEnv('VITE_FLOATY_BUILD_SHA', 'a1b2c3d')
    render(<SettingsView />)
    expect(screen.getByTestId('build-stamp')).toHaveTextContent('build a1b2c3d · local')
  })

  it('renders no Send feedback link by default, and a stamped mailto when configured', () => {
    const { unmount } = render(<SettingsView />)
    expect(screen.queryByTestId('send-feedback')).not.toBeInTheDocument()
    unmount()

    vi.stubEnv('VITE_FLOATY_FEEDBACK_MAILTO', 'owner@example.com')
    vi.stubEnv('VITE_FLOATY_BUILD_SHA', 'a1b2c3d')
    render(<SettingsView />)
    const link = screen.getByTestId('send-feedback')
    expect(link).toHaveTextContent('Send feedback')
    expect(link).toHaveAttribute(
      'href',
      `mailto:owner@example.com?subject=${encodeURIComponent('Floaty feedback — build a1b2c3d · local')}`,
    )
  })
})

describe('SettingsView — Account section (auth)', () => {
  it('renders no Account section by default (auth off / local mode — today\'s Settings)', () => {
    render(<SettingsView />)
    expect(screen.queryByRole('heading', { name: 'Account' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
  })

  it('shows who is signed in plus Sign out when the server reports an auth mode', async () => {
    const user = userEvent.setup()
    const signOut = vi.fn().mockResolvedValue(undefined)
    render(
      <AuthContext.Provider
        value={{ authMode: 'password', user: { id: 'u1', email: 'tester@floaty.dev' }, signOut }}
      >
        <SettingsView />
      </AuthContext.Provider>,
    )
    expect(screen.getByRole('heading', { name: 'Account' })).toBeInTheDocument()
    expect(screen.getByText(/Signed in as tester@floaty\.dev/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(signOut).toHaveBeenCalled()
  })
})

describe('SettingsView — Calendar section', () => {
  it('renders the Calendar section with defaults (Monday, GMT)', () => {
    render(<SettingsView />)
    expect(screen.getByRole('radiogroup', { name: 'Week starts on' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Monday' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Sunday' })).toHaveAttribute('aria-checked', 'false')
    const select = screen.getByLabelText('Timezone')
    expect((select as HTMLSelectElement).value).toBe('Etc/GMT')
  })

  it('clicking Sunday calls updateAccount with weekStartsOn: 0', async () => {
    const user = userEvent.setup()
    render(<SettingsView />)
    await user.click(screen.getByRole('radio', { name: 'Sunday' }))
    const id = useStore.getState().activeAccountId!
    const account = useStore.getState().data.accounts.find((a) => a.id === id)
    expect(account?.weekStartsOn).toBe(0)
    expect(screen.getByRole('radio', { name: 'Sunday' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Monday' })).toHaveAttribute('aria-checked', 'false')
  })

  it('changing timezone persists the new value', async () => {
    const user = userEvent.setup()
    render(<SettingsView />)
    const select = screen.getByLabelText('Timezone')
    await user.selectOptions(select, 'Europe/London')
    const id = useStore.getState().activeAccountId!
    const account = useStore.getState().data.accounts.find((a) => a.id === id)
    expect(account?.timezone).toBe('Europe/London')
  })
})
