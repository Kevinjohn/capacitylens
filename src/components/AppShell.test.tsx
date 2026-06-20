import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from './AppShell'
import { useStore } from '../store/useStore'
import { makeAppData, makeAccount, DEFAULT_ACCOUNT_ID } from '../test/fixtures'

beforeEach(() => {
  // Sign through the cosmetic demo gate AND seed an active account so the shell (not the
  // demo sign-in, not the account picker) renders — these tests exercise the nav/hydration
  // gate, which sits *after* both of those gates.
  useStore.getState().setFakeSignedIn(true)
  useStore.getState().replaceAll(makeAppData({ accounts: [makeAccount()] }))
  useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID)
  useStore.getState().clearFilters()
  // Reset hydrated state to false before each test
  useStore.getState().setHydrated(false)
})

function renderAppShell(initialEntries: string[] = ['/']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AppShell />
    </MemoryRouter>,
  )
}

describe('AppShell navigation links', () => {
  it('renders all expected nav links', () => {
    renderAppShell()

    expect(screen.getByRole('link', { name: 'Schedule' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Resources' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Disciplines' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Clients' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Activities' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Time off' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument()
  })

  it('renders the Floaty brand name in the nav', () => {
    renderAppShell()
    expect(screen.getByText('Floaty')).toBeInTheDocument()
  })

  it('renders Export and Import buttons', () => {
    renderAppShell()

    expect(screen.getByTestId('export-data')).toBeInTheDocument()
    expect(screen.getByTestId('import-data')).toBeInTheDocument()
  })

  it('nav links point to correct routes', () => {
    renderAppShell()

    expect(screen.getByRole('link', { name: 'Schedule' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'Resources' })).toHaveAttribute('href', '/resources')
    expect(screen.getByRole('link', { name: 'Disciplines' })).toHaveAttribute('href', '/disciplines')
    expect(screen.getByRole('link', { name: 'Clients' })).toHaveAttribute('href', '/clients')
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '/projects')
    expect(screen.getByRole('link', { name: 'Activities' })).toHaveAttribute('href', '/activities')
    expect(screen.getByRole('link', { name: 'Time off' })).toHaveAttribute('href', '/timeoff')
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
  })
})

describe('AppShell sidebar collapse', () => {
  beforeEach(() => {
    // Reset to the open default and forget any persisted choice from a prior test.
    act(() => {
      useStore.getState().setSidebarOpen(true)
    })
    localStorage.removeItem('floaty/sidebar')
  })

  it('defaults open (jsdom has no matchMedia → large-screen default): links + collapse toggle', () => {
    renderAppShell()

    expect(screen.getByRole('link', { name: 'Schedule' })).toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: 'Collapse menu' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryAllByTestId('nav-rail-item')).toHaveLength(0)
  })

  it('collapsing swaps links for an icon rail, persists the choice, and hides Data tools', () => {
    renderAppShell()

    act(() => {
      screen.getByRole('button', { name: 'Collapse menu' }).click()
    })

    // The skip-to-content link survives; the nine NAV links must be gone.
    expect(screen.queryByRole('link', { name: 'Schedule' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument()
    expect(screen.getAllByTestId('nav-rail-item')).toHaveLength(9)
    expect(screen.getByRole('button', { name: 'Expand menu' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('export-data')).not.toBeInTheDocument()
    expect(localStorage.getItem('floaty/sidebar')).toBe('closed')
  })

  it('rail icons do not navigate — they just reopen the menu', () => {
    renderAppShell()
    act(() => {
      useStore.getState().setSidebarOpen(false)
    })

    // Rail buttons are decorative for AT (aria-hidden, tabIndex -1); the single
    // accessible control is the toggle. Click one by test id.
    act(() => {
      screen.getAllByTestId('nav-rail-item')[3].click()
    })

    expect(screen.getByRole('link', { name: 'Schedule' })).toBeInTheDocument()
    expect(localStorage.getItem('floaty/sidebar')).toBe('open')
  })

  it('nav links carry icons without changing their accessible names', () => {
    renderAppShell()
    const link = screen.getByRole('link', { name: 'Projects' })
    expect(link.querySelector('svg')).not.toBeNull()
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('AppShell hydration gate', () => {
  it('shows "Loading…" when the store is not hydrated', () => {
    renderAppShell()

    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('does not render the outlet area when not hydrated', () => {
    renderAppShell()

    // The loading placeholder should be shown, not the outlet content area
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.queryByRole('main')?.textContent).toContain('Loading')
  })

  it('hides "Loading…" and renders outlet area after setHydrated(true)', () => {
    renderAppShell()

    // Initially shows loading
    expect(screen.getByText('Loading…')).toBeInTheDocument()

    // Set hydrated inside act so React processes the state update
    act(() => {
      useStore.getState().setHydrated(true)
    })

    // Loading text should be gone, outlet rendered instead
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
  })

  it('renders outlet area immediately when hydrated is already true', () => {
    useStore.getState().setHydrated(true)

    renderAppShell()

    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
  })
})

describe('AppShell Export/Import section', () => {
  it('shows the Export JSON button with correct test id', () => {
    renderAppShell()
    const exportBtn = screen.getByTestId('export-data')
    expect(exportBtn).toBeInTheDocument()
    expect(exportBtn.tagName).toBe('BUTTON')
    expect(exportBtn).toHaveTextContent('Export JSON')
  })

  it('shows the Import JSON button with correct test id', () => {
    renderAppShell()
    const importBtn = screen.getByTestId('import-data')
    expect(importBtn).toBeInTheDocument()
    expect(importBtn.tagName).toBe('BUTTON')
    expect(importBtn).toHaveTextContent('Import JSON')
  })

  it('has a hidden file input for importing', () => {
    renderAppShell()
    const input = screen.getByTestId('import-input')
    expect(input).toBeInTheDocument()
    expect(input).toHaveAttribute('type', 'file')
    expect(input).toHaveAttribute('accept', 'application/json')
  })
})

describe('AppShell undo/redo keyboard', () => {
  it('⌘Z undoes a data change, but is IGNORED while a form is dirty', () => {
    useStore.getState().setHydrated(true)
    renderAppShell()
    // A change so there's something to undo.
    act(() => {
      useStore.getState().addClient({ name: 'Undoable', color: '#111111' })
    })
    expect(useStore.getState().data.clients).toHaveLength(1)

    // A dirty form owns ⌘Z — undoing would revert the data behind the unsaved form (the
    // focus check alone misses non-text controls like a <select>), so it must be ignored.
    act(() => {
      useStore.getState().setDirtyForm(true)
    })
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }))
    })
    expect(useStore.getState().data.clients).toHaveLength(1) // NOT undone

    // Form no longer dirty → ⌘Z undoes as normal.
    act(() => {
      useStore.getState().setDirtyForm(false)
    })
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }))
    })
    expect(useStore.getState().data.clients).toHaveLength(0) // undone
  })
})

describe('AppShell command palette dirty-form guard', () => {
  it('Ctrl+K with dirtyForm=true shows the unsaved-changes notice and does NOT open the palette', () => {
    useStore.getState().setHydrated(true)
    renderAppShell()

    act(() => {
      useStore.getState().setDirtyForm(true)
    })
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
    })

    // Palette must NOT render
    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument()
    // Notice must show the exact message
    expect(
      screen.getByText('You have unsaved changes — use Cancel or Save to close this dialog.'),
    ).toBeInTheDocument()
  })

  it('Ctrl+K with dirtyForm=false opens the palette', () => {
    useStore.getState().setHydrated(true)
    renderAppShell()

    act(() => {
      useStore.getState().setDirtyForm(false)
    })
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
    })

    expect(screen.getByTestId('command-palette')).toBeInTheDocument()
  })
})

describe('AppShell transient notice', () => {
  it('renders a toast for a store notice and clears it on dismiss', () => {
    renderAppShell()
    expect(screen.queryByText(/could not be moved/)).not.toBeInTheDocument()

    act(() => {
      useStore.getState().setNotice('That allocation could not be moved there.')
    })
    // An info notice renders as a POLITE status toast (role="status"); only error notices are
    // assertive (role="alert"). (Query by text — a loading spinner also carries role="status".)
    const toast = screen.getByText(/could not be moved/).closest('[role="status"]')
    expect(toast).not.toBeNull()

    act(() => {
      screen.getByRole('button', { name: 'Dismiss' }).click()
    })
    expect(screen.queryByText(/could not be moved/)).not.toBeInTheDocument()
  })
})

describe('AppShell fake sign-in gate (cosmetic demo)', () => {
  it('shows the demo sign-in (not the picker/shell) when not signed in', () => {
    useStore.getState().setFakeSignedIn(false)
    useStore.getState().setHydrated(true)
    renderAppShell()

    expect(screen.getByRole('heading', { name: 'Choose an account' })).toBeInTheDocument()
    // Both downstream gates are walled off behind the demo sign-in.
    expect(screen.queryByText('Choose a company')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Schedule' })).not.toBeInTheDocument()
  })

  it('clicking the demo account signs in and reveals the next screen (the picker)', () => {
    useStore.getState().setFakeSignedIn(false)
    useStore.getState().setActiveAccount(null)
    useStore.getState().setHydrated(true)
    renderAppShell()

    act(() => {
      screen.getByTestId('fake-sign-in').click()
    })

    expect(useStore.getState().fakeSignedIn).toBe(true)
    expect(screen.getByText('Choose a company')).toBeInTheDocument()
  })
})
