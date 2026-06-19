import { Suspense, useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { disciplinesEnabledFor } from '../store/selectors'
import { useDemoAuthActive } from '../lib/fakeAuth'
import { ImportExport } from './ImportExport'
import { AccountPicker } from './accounts/AccountPicker'
import { FakeSignIn } from './FakeSignIn'
import { StorageRecovery } from './StorageRecovery'
import { ConnectionError } from './ConnectionError'
import { Toast } from './common/ui'
import { CommandPalette } from './CommandPalette'
import { Icon, type IconName } from './common/Icon'
import { RotateHint } from './RotateHint'

const LINKS: [string, string, IconName][] = [
  ['/', 'Schedule', 'calendar'],
  ['/resources', 'Resources', 'people'],
  ['/external', 'External', 'building'],
  ['/disciplines', 'Disciplines', 'tag'],
  ['/clients', 'Clients', 'briefcase'],
  ['/projects', 'Projects', 'folder'],
  ['/tasks', 'Tasks', 'clipboard-check'],
  ['/timeoff', 'Time off', 'sun'],
  ['/settings', 'Settings', 'sliders'],
]

export function AppShell() {
  const hydrated = useStore((s) => s.hydrated)
  const persistError = useStore((s) => s.persistError)
  const loadError = useStore((s) => s.loadError)
  const connectionError = useStore((s) => s.connectionError)
  const notice = useStore((s) => s.notice)
  const setNotice = useStore((s) => s.setNotice)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const accounts = useStore((s) => s.data.accounts)
  const activeAccountId = useStore((s) => s.activeAccountId)
  const setActiveAccount = useStore((s) => s.setActiveAccount)
  const activeAccount = accounts.find((a) => a.id === activeAccountId) ?? null
  // Cosmetic demo sign-in (see the gate below). `demoAuthActive` is true only when the real
  // auth seam is OFF, so the demo gate and the real login wall never double-gate.
  const demoAuthActive = useDemoAuthActive()
  const fakeSignedIn = useStore((s) => s.fakeSignedIn)
  const setFakeSignedIn = useStore((s) => s.setFakeSignedIn)
  const signOutDemo = useStore((s) => s.signOutDemo)
  // Drop the Disciplines destination from the nav when the active account doesn't use
  // disciplines (the route itself is also guarded — see router.tsx).
  const disciplinesEnabled = useStore((s) => disciplinesEnabledFor(s.data, s.activeAccountId))
  const navLinks = disciplinesEnabled ? LINKS : LINKS.filter(([to]) => to !== '/disciplines')

  const dirtyForm = useStore((s) => s.dirtyForm)
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const setSidebarOpen = useStore((s) => s.setSidebarOpen)
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Warn before a tab close / refresh would discard an open form's unsaved edits.
  useEffect(() => {
    if (!dirtyForm) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirtyForm])

  // Auto-dismiss info notices after a few seconds; ERROR notices persist until the
  // user dismisses them (an error toast that vanishes before it's read is useless).
  useEffect(() => {
    if (!notice || notice.tone === 'error') return
    const t = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(t)
  }, [notice, setNotice])


  // Global keyboard shortcuts. ⌘K/Ctrl+K opens the command palette (checked FIRST,
  // before the input bail-out so the palette can open from anywhere — including while
  // a text field is focused). ⌘Z/⌘⇧Z is undo/redo (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘K / Ctrl+K — toggle the command palette from anywhere (including inputs).
      // A dirty form owns the keyboard (mirrors the beforeunload / undo guards) —
      // show a notice and bail rather than opening a second layer of UI over the form.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (useStore.getState().dirtyForm) {
          useStore.getState().setNotice(
            'You have unsaved changes — use Cancel or Save to close this dialog.',
          )
          return
        }
        setPaletteOpen((prev) => !prev)
        return
      }

      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      // An open form with unsaved edits owns ⌘Z — never undo the data model out from under
      // it. The focus check above misses non-text controls (e.g. a <select> inside a modal),
      // so consult dirtyForm too (mirrors the beforeunload guard). Read live from the store
      // so the listener needn't resubscribe on every keystroke-driven dirty toggle.
      if (useStore.getState().dirtyForm) return
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  // Remote-load gate: the server couldn't be reached, so block with a retry screen
  // rather than the localStorage reset UI (which can't recover a server-backed app).
  if (connectionError) return <ConnectionError />

  // Corrupt-data gate: if stored data couldn't be read, block the app with a
  // recovery screen rather than letting the user edit an empty dataset that would
  // overwrite the unreadable-but-recoverable bytes.
  if (loadError) return <StorageRecovery />

  // Fake sign-in gate (cosmetic demo): show a Google-style sign-in BEFORE the account
  // picker so a viewer sees the intended "log in first, then pick a company" flow. Active
  // ONLY when real auth is OFF — an enabled login wall (AuthProvider/LoginScreen) already
  // owns the sign-in step, so never double-gate. Device-global flag (never persisted in
  // tenant data); "Sign out" (here in the sidebar, or on the picker) clears it. Keep the
  // `hydrated &&` guard so the loader still shows during hydration. The rotate hint rides
  // along — this is now a phone user's first contact.
  if (hydrated && demoAuthActive && !fakeSignedIn)
    return (
      <>
        <FakeSignIn onSignIn={() => setFakeSignedIn(true)} />
        <RotateHint />
      </>
    )

  // Tenant gate: once hydrated, no chosen account means show the picker (it's
  // never persisted, so this is every load). Kept after the hydration check so
  // the "Loading…" state still renders the shell. The rotate hint rides along —
  // the picker is a phone user's first contact, where the nudge matters most.
  if (hydrated && !activeAccount)
    return (
      <>
        <AccountPicker />
        <RotateHint />
      </>
    )

  const loader = (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-muted" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-brand" aria-hidden />
      Loading…
    </div>
  )

  return (
    <div className="flex h-full">
      {/* Skip past the sidebar nav straight to page content (WCAG 2.4.1). Hidden until focused;
          targets the <main> landmark (id="main", tabIndex=-1 so it can receive programmatic focus). */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2 focus:text-ink focus:shadow focus:ring-2 focus:ring-brand"
      >
        Skip to content
      </a>
      <nav className={`${sidebarOpen ? 'w-48' : 'w-14'} flex shrink-0 flex-col border-r border-line bg-surface p-2`}>
        {/* The collapse/expand toggle sits FIRST and at the same left inset (px-2) as every
            nav icon below it, so the toggle and the icons keep their exact x-position when the
            sidebar collapses — only the labels and the "Floaty" wordmark come and go, the
            icon column never shifts. */}
        <div className="mb-2 flex items-center gap-1">
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-expanded={sidebarOpen}
            aria-label={sidebarOpen ? 'Collapse menu' : 'Expand menu'}
            title={sidebarOpen ? 'Collapse menu' : 'Expand menu'}
            className="flex items-center rounded-md px-2 py-1.5 text-muted hover:bg-canvas hover:text-ink"
          >
            <Icon name="panel-left" />
          </button>
          {sidebarOpen && <div className="text-xl font-bold text-brand">Floaty</div>}
        </div>
        {sidebarOpen ? (
          <>
            <ul className="space-y-1">
              {navLinks.map(([to, label, icon]) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={to === '/'}
                    className={({ isActive }) =>
                      `flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                        isActive ? 'bg-brand-soft font-semibold text-ink' : 'text-ink hover:bg-canvas'
                      }`
                    }
                  >
                    <Icon name={icon} className="shrink-0 text-muted" />
                    {label}
                  </NavLink>
                </li>
              ))}
            </ul>
            <ImportExport />
            {/* Company name + "Switch company" pinned to the BOTTOM (mt-auto), with a
                divider above it closing off the data section. Kept out of the top so the
                logo/collapse header is the first thing in BOTH the open menu and the
                collapsed icon rail — otherwise this box pushes the nav down only when
                open, and the icons jump position as the sidebar collapses. */}
            {activeAccount && (
              <div className="mt-auto border-t border-line px-2 pt-3">
                <div className="truncate text-sm font-semibold text-ink" title={activeAccount.name}>
                  {activeAccount.name}
                </div>
                <button
                  type="button"
                  onClick={() => setActiveAccount(null)}
                  className="mt-0.5 block text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
                >
                  Switch company
                </button>
                {/* Demo "Sign out" — only when the real auth seam is off (it owns sign-out
                    otherwise, via Settings). `signOutDemo` drops the active company AND the
                    "back" breadcrumb, so signing back in lands on a fresh picker: "log in
                    first, THEN pick a company". */}
                {demoAuthActive && (
                  <button
                    type="button"
                    onClick={signOutDemo}
                    className="mt-1 block text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
                  >
                    Sign out
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          /* Collapsed icon rail. The icons are deliberately NOT navigation: tapping
             any of them just expands the menu (a narrow rail is a poor tap target for
             eight destinations, and a mis-tap would navigate somewhere unintended).
             They're hidden from the accessibility tree (aria-hidden + tabIndex -1) —
             keyboard and screen-reader users get the single labelled toggle above.
             Filtered through `navLinks`, so a discipline-disabled account drops the tag
             icon here too. Each icon carries an instant hover tooltip (the rail is
             otherwise unlabelled; the native `title` is slow and absent on touch). */
          <ul className="flex flex-col gap-1">
            {navLinks.map(([to, label, icon]) => (
              <li key={to} className="group/rail relative">
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden="true"
                  title={label}
                  data-testid="nav-rail-item"
                  onClick={() => setSidebarOpen(true)}
                  /* h-8 matches an expanded nav row's height (text-sm line + py-1.5), so the
                     icon-only rail keeps the SAME vertical rhythm as the open menu and the
                     icons don't bunch up / shift vertically when the sidebar collapses. */
                  className="flex h-8 w-full items-center rounded-md px-2 text-muted hover:bg-canvas hover:text-ink"
                >
                  <Icon name={icon} />
                </button>
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute left-full top-1/2 z-50 ml-1 -translate-y-1/2 whitespace-nowrap rounded bg-elevated px-2 py-1 text-xs font-medium text-ink opacity-0 shadow-pop ring-1 ring-line transition-opacity group-hover/rail:opacity-100"
                >
                  {label}
                </span>
              </li>
            ))}
          </ul>
        )}
      </nav>
      <main id="main" tabIndex={-1} className="flex-1 overflow-auto">
        {persistError && (
          <div role="alert" className="bg-danger px-4 py-2 text-sm font-medium text-white">
            Changes aren’t being saved right now — we’ll keep retrying.
          </div>
        )}
        {hydrated ? (
          <Suspense fallback={loader}>
            <Outlet />
          </Suspense>
        ) : (
          loader
        )}
      </main>
      {notice && <Toast message={notice.message} tone={notice.tone} onDismiss={() => setNotice(null)} />}
      {paletteOpen && !dirtyForm && <CommandPalette onClose={() => setPaletteOpen(false)} />}
      <RotateHint />
    </div>
  )
}
