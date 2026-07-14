import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
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
  // (the server/demo suffix is exercised in buildInfo.test.ts, where modules are reset).
  // Server is the default mode now (no demo flag), so the stamp reads `· server`.
  afterEach(() => vi.unstubAllEnvs())

  it('renders nothing when VITE_CAPACITYLENS_BUILD_SHA is unset (today\'s Settings)', () => {
    render(<SettingsView />)
    expect(screen.queryByTestId('build-stamp')).not.toBeInTheDocument()
  })

  it('renders the muted footer when the build is stamped', () => {
    vi.stubEnv('VITE_CAPACITYLENS_BUILD_SHA', 'a1b2c3d')
    render(<SettingsView />)
    expect(screen.getByTestId('build-stamp')).toHaveTextContent('build a1b2c3d · server')
  })

  it('renders no Send feedback link by default, and a stamped mailto when configured', () => {
    const { unmount } = render(<SettingsView />)
    expect(screen.queryByTestId('send-feedback')).not.toBeInTheDocument()
    unmount()

    vi.stubEnv('VITE_CAPACITYLENS_FEEDBACK_MAILTO', 'owner@example.com')
    vi.stubEnv('VITE_CAPACITYLENS_BUILD_SHA', 'a1b2c3d')
    render(<SettingsView />)
    const link = screen.getByTestId('send-feedback')
    expect(link).toHaveTextContent('Send feedback')
    expect(link).toHaveAttribute(
      'href',
      `mailto:owner@example.com?subject=${encodeURIComponent('CapacityLens feedback — build a1b2c3d · server')}`,
    )
  })
})

describe('SettingsView — Account section (auth)', () => {
  it('renders no Account section by default (auth off / demo build — today\'s Settings)', () => {
    render(<SettingsView />)
    expect(screen.queryByRole('heading', { name: 'Account' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
  })

  it('shows who is signed in plus Sign out when the server reports an auth mode', async () => {
    const user = userEvent.setup()
    const signOut = vi.fn().mockResolvedValue(undefined)
    render(
      <AuthContext.Provider
        value={{
          authMode: 'password',
          user: { id: 'u1', email: 'tester@capacitylens.dev' },
          canCreateAccount: true,
          multiAccount: true,
          refreshAuth: async () => {},
          signOut,
        }}
      >
        <SettingsView />
      </AuthContext.Provider>,
    )
    expect(screen.getByRole('heading', { name: 'Account' })).toBeInTheDocument()
    expect(screen.getByText(/Signed in as tester@capacitylens\.dev/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(signOut).toHaveBeenCalled()
  })
})

describe('SettingsView — Schedule (minimise weekends)', () => {
  it('reflects the default-on preference and toggles it through the store', async () => {
    const user = userEvent.setup()
    useStore.getState().setMinimiseWeekends(true) // deterministic starting point (device-global pref)
    render(<SettingsView />)

    const sw = screen.getByRole('switch', { name: 'Minimise weekends' })
    expect(sw).toHaveAttribute('aria-checked', 'true') // default on

    await user.click(sw)
    expect(useStore.getState().minimiseWeekends).toBe(false)
    expect(sw).toHaveAttribute('aria-checked', 'false')

    await user.click(sw)
    expect(useStore.getState().minimiseWeekends).toBe(true)
    expect(sw).toHaveAttribute('aria-checked', 'true')
  })
})

describe('SettingsView — switch target size (WCAG 2.5.8 AA, ≥24px)', () => {
  // The preferences toggle is a shared <ToggleRow> button; every preference switch (Minimise
  // weekends, Snap, Show placeholders, …) renders the same one, so checking one covers all.
  // jsdom doesn't run layout, so getBoundingClientRect() is 0×0 here — assert the height UTILITY
  // that resolves to ≥24px instead (h-6 = 1.5rem = 24px), which is what the build ships. The REAL
  // rendered ≥24px geometry is measured in e2e/minimise-weekends.spec.ts (Playwright boundingBox).
  it('renders the role="switch" control at the h-6 (24px) target-size floor', () => {
    render(<SettingsView />)
    const sw = screen.getByRole('switch', { name: 'Minimise weekends' })
    // h-6 (1.5rem = 24px) hits the 24px minimum exactly; h-5 (20px) was 4px under and failed 2.5.8.
    expect(sw).toHaveClass('h-6')
    expect(sw).not.toHaveClass('h-5')
    // Width is at least the height — a non-degenerate target (pill is wider than tall).
    expect(sw).toHaveClass('w-10')
  })
})

describe('SettingsView — Clear local storage', () => {
  // The action calls window.location.reload(); jsdom's reload is non-configurable, so we replace
  // the whole location with a stub carrying a spy (restored after each test).
  const realLocation = window.location
  let reload: ReturnType<typeof vi.fn>

  beforeEach(() => {
    reload = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...realLocation, reload },
    })
    localStorage.clear()
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
    localStorage.clear()
  })

  it('shows a destructive Clear device data button that opens a confirm modal', async () => {
    const user = userEvent.setup()
    render(<SettingsView />)

    const button = screen.getByTestId('clear-local-storage')
    expect(button).toHaveTextContent('Clear device data')
    // No modal until clicked.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(button)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(/Clear device data\?/i)
    expect(dialog).toHaveTextContent(/cannot be undone/i)
  })

  it('Cancel is a no-op — it neither clears storage nor reloads', async () => {
    const user = userEvent.setup()
    localStorage.setItem('capacitylens/offlineRead', 'on')
    localStorage.setItem('capacitylens/theme', 'dark')
    render(<SettingsView />)

    await user.click(screen.getByTestId('clear-local-storage'))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(localStorage.getItem('capacitylens/offlineRead')).toBe('on')
    expect(localStorage.getItem('capacitylens/theme')).toBe('dark')
    expect(reload).not.toHaveBeenCalled()
  })

  it('Confirm clears every capacitylens/ key and reloads', async () => {
    const user = userEvent.setup()
    localStorage.setItem('capacitylens/offlineRead', 'on')
    localStorage.setItem('capacitylens/theme', 'dark')
    localStorage.setItem('unrelated', 'leave-me') // a sibling tool's key must survive
    render(<SettingsView />)

    await user.click(screen.getByTestId('clear-local-storage'))
    // Scope to the dialog — the section button and the modal's confirm share the label.
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Clear device data' }))

    expect(localStorage.getItem('capacitylens/offlineRead')).toBeNull()
    expect(localStorage.getItem('capacitylens/theme')).toBeNull()
    expect(localStorage.getItem('unrelated')).toBe('leave-me')
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('SettingsView — Calendar section (frozen after creation, P1.14)', () => {
  it('still shows the chosen week-start / timezone, plus a frozen Language row', () => {
    render(<SettingsView />)
    expect(screen.getByRole('radiogroup', { name: 'Week starts on' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Monday' })).toHaveAttribute('aria-checked', 'true')
    expect((screen.getByLabelText('Timezone') as HTMLSelectElement).value).toBe('Etc/GMT')
    expect(screen.getByTestId('settings-language')).toHaveTextContent('English')
  })

  it('week-start and timezone controls are DISABLED (the freeze inverts the old editable contract)', () => {
    render(<SettingsView />)
    expect(screen.getByRole('radio', { name: 'Monday' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'Sunday' })).toBeDisabled()
    expect(screen.getByLabelText('Timezone')).toBeDisabled()
    // An explainer states why they can't change.
    expect(screen.getByText(/Set when the company was created and can't be changed/i)).toBeInTheDocument()
  })

  it('clicking a disabled week-start segment does NOT mutate the account', async () => {
    const user = userEvent.setup()
    render(<SettingsView />)
    await user.click(screen.getByRole('radio', { name: 'Sunday' }))
    const id = useStore.getState().activeAccountId!
    const account = useStore.getState().data.accounts.find((a) => a.id === id)
    // Default reads as 1 (Monday); the disabled click can't change it.
    expect(account?.weekStartsOn ?? 1).toBe(1)
  })
})
