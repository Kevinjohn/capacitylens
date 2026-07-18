import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { AppShell } from './AppShell'
import { useStore } from '../store/useStore'
import { makeAppData, makeAccount, DEFAULT_ACCOUNT_ID } from '../test/fixtures'
import { attachPersistence } from '../data/persist'
import { emptyAppData } from '@capacitylens/shared/types/entities'
import { setOfflineReadState } from '../data/offlineCache'

vi.mock('../data/apiConfig', () => ({
  API_BASE: '',
  isDemoMode: () => true,
  isServerConfigured: () => false,
}))

beforeEach(() => {
  // Sign through the cosmetic demo gate, dismiss the post-login intro page, AND seed an active
  // account so the shell (not the demo sign-in, not the account picker, not the intro) renders —
  // these tests exercise the nav/hydration gate, which sits *after* all of those gates.
  useStore.getState().setFakeSignedIn(true)
  useStore.getState().setIntroSeen(true)
  useStore.getState().replaceAll(makeAppData({ accounts: [makeAccount()] }))
  useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID)
  useStore.getState().clearFilters()
  // Clear any leftover transient notice so a prior test's Sonner toast can't bleed in (the
  // toast layer is module-global; the store notice is the source of truth the bridge reads).
  useStore.getState().setNotice(null)
  // Reset hydrated state to false before each test
  useStore.getState().setHydrated(false)
  setOfflineReadState(false)
})

function renderAppShell(initialEntries: string[] = ['/'], includeLocationProbe = false) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AppShell />
      {includeLocationProbe && <LocationProbe />}
    </MemoryRouter>,
  )
}

function LocationProbe() {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <button type="button" data-testid="location-probe" onClick={() => void navigate('/settings?tab=security')}>
      {location.pathname}{location.search}{location.hash}
    </button>
  )
}

it('consumes a joined-account query only once and preserves later route queries', async () => {
  renderAppShell([`/?joinedAccount=${DEFAULT_ACCOUNT_ID}`], true)

  await waitFor(() => expect(screen.getByTestId('location-probe')).toHaveTextContent(/^\/$/))
  fireEvent.click(screen.getByTestId('location-probe'))
  await waitFor(() => expect(screen.getByTestId('location-probe')).toHaveTextContent('/settings?tab=security'))
})

it('guards navigation while a persistence write is still unacknowledged', () => {
  const detachPersistence = attachPersistence(
    useStore,
    { loadAll: async () => emptyAppData(), saveAll: async () => {} },
    300,
  )
  const { unmount } = renderAppShell()
  act(() => {
    useStore.getState().addClient({ name: 'Unsaved client', color: '#111111' })
  })

  const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
  window.dispatchEvent(event)

  expect(useStore.getState().dirtyForm).toBe(false)
  expect(event.defaultPrevented).toBe(true)
  unmount()
  detachPersistence()
})

describe('AppShell navigation links', () => {
  it('labels a cached snapshot as Offline and view only instead of Demo access', () => {
    setOfflineReadState(true, Date.parse('2026-07-17T10:00:00.000Z'))
    renderAppShell()

    expect(screen.getByTestId('active-role')).toHaveTextContent('Offline · View only')
    expect(screen.getByTestId('active-role')).not.toHaveTextContent('Demo access')
    expect(screen.getByTestId('view-only')).toHaveTextContent('Offline · View only')
  })

  it('renders all expected nav links', () => {
    renderAppShell()

    expect(screen.getByRole('link', { name: 'Schedule' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Resources' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Team & access' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Disciplines' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Clients' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Activities' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Time off' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument()
  })

  it('renders the CapacityLens brand name in the nav', () => {
    renderAppShell()
    expect(screen.getByText('CapacityLens')).toBeInTheDocument()
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
    expect(screen.getByRole('link', { name: 'Team & access' })).toHaveAttribute('href', '/team')
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
    localStorage.removeItem('capacitylens/sidebar')
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

    // The skip-to-content link survives; the nine NAV links must be gone (External moved into the
    // Resources tab, so it's no longer a standalone nav link).
    expect(screen.queryByRole('link', { name: 'Schedule' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument()
    expect(screen.getAllByTestId('nav-rail-item')).toHaveLength(9)
    expect(screen.getByRole('button', { name: 'Expand menu' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('export-data')).not.toBeInTheDocument()
    expect(localStorage.getItem('capacitylens/sidebar')).toBe('closed')
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
    expect(localStorage.getItem('capacitylens/sidebar')).toBe('open')
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
  it('Ctrl+K with dirtyForm=true shows the unsaved-changes notice and does NOT open the palette', async () => {
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
    // Notice must show the exact message. It's surfaced via a Sonner toast now (bridged from
    // the store `notice`), which portals in asynchronously — so await it.
    expect(
      await screen.findByText('You have unsaved changes — use Cancel or Save to close this dialog.'),
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
  // The store `notice`/`setNotice` API is unchanged; AppShell now bridges it to a Sonner
  // toast (the hand-rolled Toast was retired in shadcn Phase 5). Sonner portals the toast in
  // asynchronously inside a polite live region (<section aria-label="Notifications…"
  // aria-live="polite">), each toast a `li[data-sonner-toast]` with an aria-label="Close
  // toast" button — so these assertions match Sonner's DOM, while the behavioural intent
  // (info appears + auto-dismisses, error persists + is dismissible, store stays in sync)
  // is preserved.
  it('renders a Sonner toast for an info store notice and clears it on dismiss', async () => {
    renderAppShell()
    expect(screen.queryByText(/could not be moved/)).not.toBeInTheDocument()

    act(() => {
      useStore.getState().setNotice('That allocation could not be moved there.')
    })
    // Sonner portals the toast in asynchronously; wait for it, then confirm it's a real Sonner
    // toast living in the polite live region (not, say, a loading spinner's status node).
    const message = await screen.findByText(/could not be moved/)
    expect(message.closest('[data-sonner-toast]')).not.toBeNull()
    expect(message.closest('[aria-live="polite"]')).not.toBeNull()

    // Dismiss via Sonner's close button (aria-label "Close toast"); the bridge's onDismiss
    // calls setNotice(null), so the store clears in lock-step with the toast leaving.
    act(() => {
      screen.getByRole('button', { name: 'Close toast' }).click()
    })
    await waitFor(() => expect(useStore.getState().notice).toBeNull())
    await waitFor(() => expect(screen.queryByText(/could not be moved/)).not.toBeInTheDocument())
  })

  it('keeps an ERROR notice on screen past the 4s info window (no auto-dismiss), unlike info', async () => {
    // Drive Sonner's auto-close timer with FAKE timers so we can genuinely advance past the
    // 4000ms info window deterministically (a real 4s wait is too slow + flaky). `findBy*`
    // polls on real timers, so we never use it here — we pump Sonner's mount + dismiss timers
    // with advanceTimersByTimeAsync and read synchronously. Restored in finally so the other
    // async tests in this file keep their real-timer behaviour.
    vi.useFakeTimers()
    try {
      renderAppShell()

      // BASELINE — an INFO notice MUST auto-dismiss once the 4000ms window elapses. Prove the
      // window actually closes (so the error assertion below isn't vacuously true).
      act(() => {
        useStore.getState().setNotice('Info that should auto-dismiss.')
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50) // let Sonner mount/portal the toast
      })
      expect(screen.getByText(/auto-dismiss/)).toBeInTheDocument()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4500) // past the 4000ms info window + exit animation
      })
      expect(screen.queryByText(/auto-dismiss/)).not.toBeInTheDocument()
      expect(useStore.getState().notice).toBeNull() // bridge cleared the store in lock-step

      // ERROR — created with duration: Infinity, so the SAME 4500ms advance must NOT dismiss it.
      act(() => {
        useStore.getState().setNotice('That allocation could not be moved.', 'error')
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50)
      })
      const message = screen.getByText(/could not be moved/)
      expect(message.closest('[data-sonner-toast]')).not.toBeNull()
      // Tagged for the danger affordance (index.css `.toast-error`) so it reads as an error.
      expect(message.closest('[data-sonner-toast]')).toHaveClass('toast-error')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4500) // well past where an info toast would have gone
      })
      expect(screen.getByText(/could not be moved/)).toBeInTheDocument()
      expect(useStore.getState().notice?.tone).toBe('error')

      // It is still dismissible, and dismissal clears the store in lock-step.
      act(() => {
        screen.getByRole('button', { name: 'Close toast' }).click()
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500) // exit animation → removal + onDismiss
      })
      expect(useStore.getState().notice).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a WARNING notice on screen past the 4s info window, on the NEUTRAL surface (WCAG 2.2.1)', async () => {
    // The 'warning' tone (e.g. the clamped-hours/data-truncation advisory) must inherit the
    // persistent (duration: Infinity) treatment like an error — a fixed 4s timer on the sole signal
    // of a silent truncation fails WCAG 2.2.1 — but must NOT carry the danger `.toast-error` accent,
    // since the edit SUCCEEDED. Same fake-timer technique as the info-vs-error test above.
    vi.useFakeTimers()
    try {
      renderAppShell()

      act(() => {
        useStore.getState().setNotice('Work volume was capped at 24h/day.', 'warning')
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50) // let Sonner mount/portal the toast
      })
      const message = screen.getByText(/capped at 24h\/day/)
      const toastEl = message.closest('[data-sonner-toast]')
      expect(toastEl).not.toBeNull()
      // NEUTRAL surface: not raised via toast.error, so no danger accent (unlike the error tone).
      expect(toastEl).not.toHaveClass('toast-error')

      // Persists well past where an INFO toast (4000ms) would have auto-dismissed.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4500)
      })
      expect(screen.getByText(/capped at 24h\/day/)).toBeInTheDocument()
      expect(useStore.getState().notice?.tone).toBe('warning')

      // Still dismissible via the close button; dismissal clears the store in lock-step.
      act(() => {
        screen.getByRole('button', { name: 'Close toast' }).click()
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })
      expect(useStore.getState().notice).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('rapidly replacing notice A with B leaves B intact (no stale-clear race)', async () => {
    // REGRESSION for the Phase-5 stale-clear race: rapidly swapping notice A→B (e.g. two drags
    // in quick succession) must NOT let A's deferred programmatic dismiss wipe B. When the bridge
    // replaces A's toast it runs cleanup `toast.dismiss(idA)`, and Sonner fires A's `onDismiss`
    // even for a *programmatic* dismiss — so without the `=== thisNotice` identity guard A's
    // `clear()` would call setNotice(null) and erase B. (Verified: with the guard removed the
    // store reads `notice === undefined` here instead of B.) Fake timers let us pump Sonner's
    // deferred-dismiss + exit-animation rAFs for A deterministically while staying WELL under the
    // 4000ms auto-dismiss window, so B never auto-closes — we isolate the swap race, not the timer.
    vi.useFakeTimers()
    try {
      renderAppShell()

      // A mounts first (its bridge effect runs, Sonner portals toast A) — the swap must dismiss a
      // *real* live toast for the race to exist at all.
      act(() => {
        useStore.getState().setNotice('First notice')
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50) // let Sonner mount/portal toast A
      })
      expect(screen.getByText('First notice')).toBeInTheDocument()

      // The back-to-back second notice REPLACES A — this is what tears A's toast down and fires
      // A's deferred onDismiss (the thing that, unguarded, would wipe B).
      act(() => {
        useStore.getState().setNotice('Second notice')
      })
      // Pump A's deferred dismiss rAF, THEN its exit-animation removal, in two steps — Sonner
      // chains those across rAF/flush boundaries, so a single big advance can leave A's node
      // mid-animation. Total here (~250ms post-swap) stays well under the 4000ms auto-dismiss,
      // so B never auto-closes.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50) // A's deferred onDismiss fires (the race trigger)
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200) // A's exit animation completes → node removed
      })

      // CORE ASSERTION — the store still holds B (A's deferred clear was identity-guarded out; an
      // unguarded bridge leaves this undefined). Read synchronously: `findBy*` polls on real timers
      // and would hang under fake timers, so we never use it here.
      expect(useStore.getState().notice?.message).toBe('Second notice')
      // B is on screen as a real Sonner toast; A's toast has left the DOM (its 300ms dismiss +
      // exit completed), proving A's teardown removed only A, not B.
      const message = screen.getByText('Second notice')
      expect(message.closest('[data-sonner-toast]')).not.toBeNull()
      expect(screen.queryByText('First notice')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
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
