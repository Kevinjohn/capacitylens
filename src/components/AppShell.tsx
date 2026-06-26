import { Suspense, useEffect, useState, type CSSProperties } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { Toaster, toast } from 'sonner'
import { useStore } from '../store/useStore'
import { disciplinesEnabledFor } from '../store/selectors'
import { useDemoAuthActive } from '../lib/fakeAuth'
import { ImportExport } from './ImportExport'
import { AccountPicker } from './accounts/AccountPicker'
import { FakeSignIn } from './FakeSignIn'
import { IntroPage } from './IntroPage'
import { StorageRecovery } from './StorageRecovery'
import { ConnectionError } from './ConnectionError'
import { CommandPalette } from './CommandPalette'
import { PermissionProvider } from '../auth/PermissionProvider'
import { useRole } from '../auth/permissionContext'
import { useAccountSummaries } from '../auth/useAccountSummaries'
import { Icon, type IconName } from './common/Icon'
import { RotateHint } from './RotateHint'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip'
import { cn } from '@/lib/utils'
import { m, syncLocaleFromAccount } from '@/i18n'

/**
 * A nav destination: `[route, labelFn, icon]`. The label is a **getter** (`() => m.nav_x()`), not a
 * pre-resolved string, so each destination's text is resolved at RENDER (inside the `navLinks.map`
 * sites below) rather than at module load. That matters for i18n (P1.5.2): `LINKS` is module-scope,
 * and calling `m.nav_x()` here would freeze the label to the locale active at import — the getter
 * defers it to render so a locale switch (account change) re-resolves the text on the next render.
 */
type NavLinkDef = [to: string, label: () => string, icon: IconName]

const LINKS: NavLinkDef[] = [
  ['/', () => m.nav_schedule(), 'calendar'],
  ['/resources', () => m.nav_resources(), 'people'],
  // External / 3rd parties moved INTO the Resources tab behind a per-account setting
  // (`externalEnabled` on the Account, default off — Settings → External). They no longer have their
  // own nav link; the old /external route redirects to /resources for saved bookmarks.
  ['/disciplines', () => m.nav_disciplines(), 'tag'],
  ['/clients', () => m.nav_clients(), 'briefcase'],
  ['/projects', () => m.nav_projects(), 'folder'],
  ['/activities', () => m.nav_activities(), 'clipboard-check'],
  ['/timeoff', () => m.nav_timeoff(), 'sun'],
  ['/settings', () => m.nav_settings(), 'sliders'],
]

export function AppShell() {
  // Populate the AccountPicker's list (P1.13): server mode fetches GET /api/accounts, local mode
  // derives from data.accounts. Mounted at the TOP so it runs before (and during) the tenant gate
  // below — the picker needs the list before any account is chosen. A side-effect hook, renders nothing.
  useAccountSummaries()
  const hydrated = useStore((s) => s.hydrated)
  const persistError = useStore((s) => s.persistError)
  const loadError = useStore((s) => s.loadError)
  const connectionError = useStore((s) => s.connectionError)
  const notice = useStore((s) => s.notice)
  const setNotice = useStore((s) => s.setNotice)
  // Drives Sonner's theme (see the <Toaster> below). An explicit light|dark pref is passed
  // through as the concrete scheme; a 'system' pref is delegated to Sonner ('system'), which
  // subscribes to prefers-color-scheme itself and so stays live when the OS flips (this shell
  // wouldn't re-render on that, which is why we don't resolve 'system' here).
  const themePref = useStore((s) => s.theme)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
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
  const [paletteOpen, setPaletteOpen] = useState(false)

  // i18n seam (P1.5.1): the active company's UI language drives the Paraglide runtime. Read it from
  // the FULL account in `data.accounts` (the loaded tenant slice) — `accountSummaries` is only a
  // one-frame gap-filler in server mode and carries no `language`. Absent ⇒ baseLocale ('en').
  const activeLanguage = accounts.find((a) => a.id === activeAccountId)?.language

  // Apply that language to the Paraglide runtime. Account-scoped + client-only (no page reload — see
  // src/i18n), so it re-applies whenever the active account (or its language) changes. English-only
  // today; this is the single wiring point for future locales.
  useEffect(() => {
    syncLocaleFromAccount(activeLanguage)
  }, [activeLanguage])

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

  // Bridge the store's `notice` → a Sonner toast. The store API (setNotice/notice) is the
  // single source of truth (used at ~47 sites); this effect is the only thing that turns it
  // into UI. Info toasts auto-dismiss after 4s (Sonner's `duration` owns the timer — no
  // hand-rolled setTimeout); error toasts persist until dismissed (an error that vanishes
  // before it's read is useless). Either way, dismissal/auto-close calls `clear()` so the
  // store stays in sync with what's on screen.
  //
  // Teardown: the cleanup `toast.dismiss(id)` removes this toast whenever `notice` changes or
  // clears, so a new notice REPLACES the old one — never a duplicate/stale toast.
  //
  // Identity-guarded clear: Sonner runs `onDismiss` on a *programmatic* `toast.dismiss(id)`
  // too — so the cleanup above would fire this toast's `clear` even when we replaced notice A
  // with a newer notice B. Guarding on `=== thisNotice` makes a toast clear the store ONLY
  // while the store still holds the exact notice that toast represents; a back-to-back A→B
  // swap leaves B intact (setNotice mints a fresh object per call, so `===` identity is exact).
  useEffect(() => {
    if (!notice) return
    const thisNotice = notice
    const clear = () => {
      if (useStore.getState().notice === thisNotice) setNotice(null)
    }
    const id =
      thisNotice.tone === 'error'
        ? toast.error(thisNotice.message, { duration: Infinity, onDismiss: clear })
        : toast(thisNotice.message, { duration: 4000, onDismiss: clear, onAutoClose: clear })
    return () => {
      toast.dismiss(id)
    }
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

  // Post-login intro gate: a one-time "What CapacityLens is" page shown AFTER a company is chosen and
  // BEFORE the app proper, explaining CapacityLens is a resourcing tool, not a project-management tool.
  // This single slot sits after the tenant gate so it covers ALL THREE entry modes — they all
  // converge here on a chosen activeAccount: real-auth (login wall → picker), the cosmetic
  // fake-sign-in, and the no-auth default. Device-global once-per-device flag (`capacitylens/introSeen`,
  // NOT persisted in tenant data); Continue flips it and the app renders. The rotate hint rides
  // along, mirroring the gates above.
  if (hydrated && activeAccount && !introSeen)
    return (
      <>
        <IntroPage onContinue={() => setIntroSeen(true)} />
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
    // PermissionProvider (P1.12) wraps the APP BODY — mounted HERE, AFTER the connection/load/auth/
    // tenant/intro gates above, so `activeAccountId` is already set when it resolves the role. It is a
    // pure pass-through (role: null, no fetch) in OFF/local; only an auth-on + server deploy resolves a
    // real role and gates affordances. The view-only badge + every gated affordance hub read the role
    // from THIS provider (so they live inside the subtree, not above it).
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
                {/* "View only" badge (P1.12) — appears here for a Viewer; renders nothing otherwise
                    (incl. the default OFF/local deploy). Inside PermissionProvider's subtree. */}
                <ViewOnlyBadge />
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
             eight destinations, and a mis-tap would navigate somewhere unintended).
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
      {paletteOpen && !dirtyForm && <CommandPalette onClose={() => setPaletteOpen(false)} />}
      <RotateHint />
    </div>
    </PermissionProvider>
  )
}

/**
 * The "View only" badge (P1.12) — shown in the sidebar footer beside the company name when the
 * active account's role resolves to `viewer`. Subtle, non-interactive. It is a SEPARATE component so
 * it consumes the role from {@link PermissionProvider} (mounted around the app body in AppShell);
 * `useRole()` called at AppShell's top level would read the OUTER default (null), not this provider.
 * Renders nothing for any non-viewer role (incl. OFF/local → null), so the default deploy shows it
 * never.
 */
function ViewOnlyBadge() {
  if (useRole() !== 'viewer') return null
  return (
    <span
      data-testid="view-only"
      className="mt-1 inline-flex items-center gap-1 rounded bg-canvas px-1.5 py-0.5 text-2xs font-medium text-muted ring-1 ring-line"
      title={m.nav_view_only_title()}
    >
      <Icon name="eye" size={11} aria-hidden />
      {m.nav_view_only()}
    </span>
  )
}
