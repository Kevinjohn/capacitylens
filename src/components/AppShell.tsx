import { Suspense, type CSSProperties } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { Toaster } from 'sonner'
import { useStore } from '../store/useStore'
import { disciplinesEnabledFor } from '../store/selectors'
import { useDemoAuthActive } from '../lib/fakeAuth'
import { ImportExport } from './ImportExport'
import { CommandPalette } from './CommandPalette'
import { PermissionProvider } from '../auth/PermissionProvider'
import { usePermissionStatus, useRole } from '../auth/permissionContext'
import { useAuth } from '../auth/authContext'
import { Icon } from './common/Icon'
import { RotateHint } from './RotateHint'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip'
import { Badge } from './ui/badge'
import { cn } from '@/lib/utils'
import { m } from '@/i18n'
import { LINKS } from '../lib/navLinks'
import { useOfflineState } from '../data/useOfflineState'
import { accessLabelFor } from '../lib/accessCopy'
import { accessExperienceFor } from '../lib/accessMode'
import { AppEntryGate } from './AppEntryGate'
import { useAppShellController } from './useAppShellController'

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
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-brand" aria-hidden />
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
    <div className="flex h-full">
      {/* Skip past the sidebar nav straight to page content (WCAG 2.4.1). Hidden until focused;
          targets the <main> landmark (id="main", tabIndex=-1 so it can receive programmatic focus). */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2 focus:text-ink focus:shadow focus:ring-2 focus:ring-brand"
      >
        {m.nav_skip_to_content()}
      </a>
      <nav className={cn(sidebarOpen ? 'w-48' : 'w-14', 'flex shrink-0 flex-col border-r border-line bg-surface p-2')}>
        {/* The collapse/expand toggle sits FIRST and at the same left inset (px-2) as every
            nav icon below it, so the toggle and the icons keep their exact x-position when the
            sidebar collapses — only the labels and the "CapacityLens" wordmark come and go, the
            icon column never shifts. */}
        <div className="mb-2 flex items-center gap-1">
          {/* Tooltips consistency pass (DONE): this FOCUSABLE toggle uses the shadcn Radix
              Tooltip (ui/tooltip.tsx) — instant (delayDuration 0), restyled to capacitylens's
              elevated-surface tokens — so its hover/focus label is the same mechanism the rest of
              the shell aims for and there's no native `title` left here. The button keeps its own
              aria-label as the accessible name (the tooltip is supplementary, never the sole name);
              because the toggle is focusable, Radix surfaces the label on BOTH hover and keyboard
              focus. The collapsed rail below is a DELIBERATE exception (see there): its buttons are
              aria-hidden + non-focusable mouse-only decorations, so they keep the hand-rolled visual
              hover span — the correct pattern for an out-of-a11y-tree element — and likewise carry no
              native `title`. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                aria-expanded={sidebarOpen}
                aria-label={sidebarOpen ? m.nav_collapse_menu() : m.nav_expand_menu()}
                className="flex items-center rounded-md px-2 py-1.5 text-muted hover:bg-canvas hover:text-ink"
              >
                <Icon name="panel-left" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{sidebarOpen ? m.nav_collapse_menu() : m.nav_expand_menu()}</TooltipContent>
          </Tooltip>
          {/* i18n demonstrator (P1.5.1): the sidebar wordmark reads the brand through the typed
              Paraglide message `m.app_name()` (single key in messages/en.json, value == APP_NAME from
              shared/brand, so this is visibly identical and respects the brand single-source — P0.0).
              This is the ONE real render that references the message in type-checked code: delete the
              `app_name` key and recompile and `m.app_name` vanishes → tsc/build fails. That is the
              compile-time-safety acceptance, made real at a live UI site. */}
          {sidebarOpen && <div className="text-xl font-bold text-brand">{m.app_name()}</div>}
        </div>
        {sidebarOpen ? (
          <>
            <ul className="space-y-1">
              {navLinks.map(([to, label, icon]) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={to === '/'}
                    /* Tour anchor (see lib/tour.ts): a route-keyed hook present in BOTH sidebar
                       states — this open-menu link and the collapsed rail button below carry the
                       same `data-nav`, so a `[data-nav="/x"]` selector matches whichever variant
                       is rendered. NOT an e2e selector (specs use role/name); don't key tests on it. */
                    data-nav={to}
                    className={({ isActive }) =>
                      `flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                        isActive ? 'bg-brand-soft font-semibold text-ink' : 'text-ink hover:bg-canvas'
                      }`
                    }
                  >
                    <Icon name={icon} className="shrink-0 text-muted" />
                    {label()}
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
                <ActiveRoleBadge />
                <button
                  type="button"
                  onClick={() => setActiveAccount(null)}
                  className="mt-0.5 block text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
                >
                  {m.nav_switch_company()}
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
                    {m.nav_sign_out()}
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          /* Collapsed icon rail. The icons are deliberately NOT navigation: tapping
             any of them just expands the menu (a narrow rail is a poor tap target for
             nine destinations, and a mis-tap would navigate somewhere unintended).
             They're hidden from the accessibility tree (aria-hidden + tabIndex -1) —
             keyboard and screen-reader users get the single labelled toggle above.
             Filtered through `navLinks`, so a discipline-disabled account drops the tag
             icon here too.

             Tooltips consistency pass (DONE) — rail decision = KEEP the hand-rolled visual
             hover span, deliberately NOT the shadcn Radix Tooltip. Radix's TooltipTrigger is
             built around a trigger that lives IN the a11y tree and is focusable; these buttons
             are the opposite by design (aria-hidden + tabIndex -1, mouse-only — a mouse-only rail
             supports no focus interaction to anchor a Radix tooltip to). A plain absolutely-
             positioned span shown on `group-hover/rail` is the correct, well-understood pattern
             for labelling an out-of-a11y-tree decorative element, with no risk of Radix fighting
             aria-hidden or forcing focusability. So the shell ends up with TWO label mechanisms
             on purpose: the focusable toggle above on the Radix Tooltip, this mouse-only rail on
             a visual span — but NO native `title` anywhere on AppShell's icon buttons (the slow,
             touch-absent default we were standardising away). The span reuses the SAME
             elevated/ink/line/shadow-pop tokens as ui/tooltip.tsx, so the two look identical.
             `data-label` carries the section label as the e2e selector hook (it replaced the old
             `title`, which the mobile/disciplines specs keyed on). */
          <ul className="flex flex-col gap-1">
            {navLinks.map(([to, label, icon]) => (
              <li key={to} className="group/rail relative">
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden="true"
                  data-label={label()}
                  data-testid="nav-rail-item"
                  data-nav={to}
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
                  {label()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </nav>
      <main id="main" tabIndex={-1} className="flex-1 overflow-auto">
        {offline.readOnly && (
          <div role="status" data-testid="offline-read-only" className="bg-brand px-4 py-2 text-sm font-medium text-white">
            {m.app_offline_read_only({
              updated: offline.lastUpdated ? new Date(offline.lastUpdated).toLocaleString() : m.app_offline_unknown_time(),
            })}
          </div>
        )}
        {persistError && (
          <div role="alert" className="bg-danger px-4 py-2 text-sm font-medium text-white">
            {m.app_persist_error()}
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
    </div>
    </PermissionProvider>
    </AppEntryGate>
  )
}

/**
 * The active-role badge — shown in the sidebar footer beside the company name for every access
 * level. It is a SEPARATE component so
 * it consumes the role from {@link PermissionProvider} (mounted around the app body in AppShell);
 * `useRole()` called at AppShell's top level would read the OUTER default (null), not this provider.
 * A null role is the clearly-labelled non-authenticated demo/local experience, not a real Owner.
 */
function ActiveRoleBadge() {
  const role = useRole()
  const permissionStatus = usePermissionStatus()
  const { authMode } = useAuth()
  const offline = useOfflineState()
  const accessExperience = accessExperienceFor(authMode)
  const resolvedRole = accessExperience === 'authenticated' && permissionStatus === 'resolved' ? role : null
  const label = accessLabelFor({
    offlineReadOnly: offline.readOnly,
    experience: accessExperience,
    permissionStatus,
    role: resolvedRole,
  })
  const viewOnly = offline.readOnly || resolvedRole === 'viewer'
  return (
    <Badge
      data-testid="active-role"
      variant="outline"
      className="mt-1 text-2xs text-muted"
      title={viewOnly ? m.nav_view_only_title() : undefined}
    >
      {viewOnly && <Icon name="eye" size={11} />}
      {offline.readOnly ? (
        <span data-testid="view-only">{label}</span>
      ) : resolvedRole === 'viewer' ? (
        <>
          {label} · <span data-testid="view-only">{m.nav_view_only()}</span>
        </>
      ) : label}
    </Badge>
  )
}
