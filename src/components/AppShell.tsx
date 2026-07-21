import { Suspense, type CSSProperties } from 'react'
import { Outlet } from 'react-router-dom'
import { Toaster } from 'sonner'
import { useStore } from '../store/useStore'
import { disciplinesEnabledFor } from '../store/selectors'
import { useDemoAuthActive } from '../lib/fakeAuth'
import { CommandPalette } from './CommandPalette'
import { PermissionProvider } from '../auth/PermissionProvider'
import { RotateHint } from './RotateHint'
import { Spinner } from './ui/spinner'
import { Alert, AlertDescription } from './ui/alert'
import { m } from '@/i18n'
import { LINKS } from '../lib/navLinks'
import { useOfflineState } from '../data/useOfflineState'
import { AppEntryGate } from './AppEntryGate'
import { useAppShellController } from './useAppShellController'
import { AppSidebar } from './AppSidebar'
import { SidebarProvider, SidebarTrigger } from './ui/sidebar'

export function AppShell() {
  const { paletteOpen, closePalette } = useAppShellController()
  const hydrated = useStore((s) => s.hydrated)
  const persistError = useStore((s) => s.persistError)
  const loadError = useStore((s) => s.loadError)
  const connectionError = useStore((s) => s.connectionError)
  const offline = useOfflineState()
  // Drives Sonner's theme (see the <Toaster> below). An explicit light|dark pref is passed
  // through as the concrete scheme; a 'system' pref is delegated to Sonner ('system'), which
  // subscribes to prefers-color-scheme itself and so stays live when the OS flips (this shell
  // wouldn't re-render on that, which is why we don't resolve 'system' here).
  const themePref = useStore((s) => s.theme)
  const accounts = useStore((s) => s.data.accounts)
  const accountSummaries = useStore((s) => s.accountSummaries)
  const activeAccountId = useStore((s) => s.activeAccountId)
  const setActiveAccount = useStore((s) => s.setActiveAccount)
  // EXISTENCE of the active account from `data.accounts` (after the slice loads, it holds exactly the
  // active account) OR `accountSummaries` (P1.13 — covers the pick→slice-load gap in server mode,
  // where `data` is empty for one frame until the switch orchestrator hydrates the slice). The summary
  // is enough to pass the tenant gate and render the shell; the slice fills in the body a frame later.
  const activeAccount =
    accounts.find((a) => a.id === activeAccountId) ?? accountSummaries.find((a) => a.id === activeAccountId) ?? null
  // Cosmetic demo sign-in (see the gate below). `demoAuthActive` is true only when the real
  // auth seam is OFF, so the demo gate and the real login wall never double-gate.
  const demoAuthActive = useDemoAuthActive()
  const fakeSignedIn = useStore((s) => s.fakeSignedIn)
  const setFakeSignedIn = useStore((s) => s.setFakeSignedIn)
  const signOutDemo = useStore((s) => s.signOutDemo)
  // Post-login intro gate (see below). Device-global, once-per-device flag.
  const introSeen = useStore((s) => s.introSeen)
  const setIntroSeen = useStore((s) => s.setIntroSeen)
  // Drop the Disciplines destination from the nav when the active account doesn't use
  // disciplines (the route itself is also guarded — see router.tsx).
  const disciplinesEnabled = useStore((s) => disciplinesEnabledFor(s.data, s.activeAccountId))
  const navLinks = disciplinesEnabled ? LINKS : LINKS.filter(([to]) => to !== '/disciplines')

  const dirtyForm = useStore((s) => s.dirtyForm)
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const setSidebarOpen = useStore((s) => s.setSidebarOpen)

  const loader = (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-muted" role="status">
      <Spinner role="presentation" aria-label={undefined} />
      {m.app_loading()}
    </div>
  )

  return (
    <AppEntryGate
      hydrated={hydrated}
      connectionError={connectionError}
      loadError={loadError}
      demoAuthActive={demoAuthActive}
      fakeSignedIn={fakeSignedIn}
      hasActiveAccount={activeAccount !== null}
      introSeen={introSeen}
      onFakeSignIn={() => setFakeSignedIn(true)}
      onIntroContinue={() => setIntroSeen(true)}
    >
    {/* PermissionProvider resolves permissions only after the entry boundary has selected the app body. */}
    <PermissionProvider>
    <SidebarProvider
      open={sidebarOpen}
      onOpenChange={setSidebarOpen}
      className="h-full min-h-0"
      style={
        {
          '--sidebar-width': '12rem',
          '--sidebar-width-icon': '3.5rem',
        } as CSSProperties
      }
    >
      {/* Skip past the sidebar nav straight to page content (WCAG 2.4.1). Hidden until focused;
          targets the <main> landmark (id="main", tabIndex=-1 so it can receive programmatic focus). */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2 focus:text-ink focus:shadow focus:ring-2 focus:ring-brand"
      >
        {m.nav_skip_to_content()}
      </a>
      <AppSidebar
        activeAccount={activeAccount}
        demoAuthActive={demoAuthActive}
        navLinks={navLinks}
        onSignOut={signOutDemo}
        onSwitchAccount={() => setActiveAccount(null)}
        open={sidebarOpen}
      />
      <main id="main" tabIndex={-1} className="min-w-0 flex-1 overflow-auto">
        <div className="border-b border-line p-2 md:hidden">
          <SidebarTrigger aria-label={m.nav_expand_menu()} />
        </div>
        {offline.readOnly && (
          <Alert role="status" data-testid="offline-read-only" className="rounded-none border-x-0 border-t-0">
            <AlertDescription>{m.app_offline_read_only({
              updated: offline.lastUpdated ? new Date(offline.lastUpdated).toLocaleString() : m.app_offline_unknown_time(),
            })}</AlertDescription>
          </Alert>
        )}
        {persistError && (
          <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
            <AlertDescription>{m.app_persist_error()}</AlertDescription>
          </Alert>
        )}
        {hydrated ? (
          <Suspense fallback={loader}>
            <Outlet />
          </Suspense>
        ) : (
          loader
        )}
      </main>
      {/* Sonner toaster — bottom-centre (matches the retired Toast's `bottom-4`). `theme`: an
          explicit light|dark pref is passed through concrete; a 'system' pref delegates to Sonner
          ('system'), which subscribes to prefers-color-scheme itself so an OS flip re-themes the
          toasts live (this shell doesn't re-render on that). Explicit prefs still track capacitylens's
          [data-theme] dark mode through the --normal-* vars below. `closeButton` gives every toast
          a dismiss control (aria-label "Close toast"); the store `notice` is the source of truth,
          the effect above feeds it.

          NOT `richColors`: its light-mode error palette (red #e60000 on pink #fff0f0) is 4.34:1,
          just under WCAG AA (the a11y gate is hard, not advisory). Instead we paint every toast
          on capacitylens's already-AA-validated elevated/ink/line tokens (the old hand-rolled Toast was
          likewise one neutral surface for both tones). Wired through Sonner's --normal-* CSS vars
          so it tracks [data-theme] for free.

          Error distinction is restored WITHOUT richColors: the `toast-error` class (styled in
          index.css off capacitylens's --color-danger) gives error toasts a danger left-accent + ring +
          icon tint over the same AA-safe neutral surface, so an error reads as an error at a
          glance in both themes. */}
      <Toaster
        theme={themePref === 'system' ? 'system' : themePref}
        position="bottom-center"
        closeButton
        toastOptions={{ classNames: { error: 'toast-error' } }}
        style={
          {
            '--normal-bg': 'var(--color-elevated)',
            '--normal-text': 'var(--color-ink)',
            '--normal-border': 'var(--color-line)',
          } as CSSProperties
        }
      />
      {paletteOpen && !dirtyForm && <CommandPalette onClose={closePalette} />}
      <RotateHint />
    </SidebarProvider>
    </PermissionProvider>
    </AppEntryGate>
  )
}
