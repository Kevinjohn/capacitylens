import { useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore, emptyFilters } from '../store/useStore'
import { disciplinesEnabledFor, externalEnabledFor, placeholdersEnabledFor } from '../store/selectors'
import { useActiveScopedData } from '../store/useScopedData'
import { fuzzyFilter } from '../lib/fuzzy'
import { resourceDisplayName } from '../lib/metadata'
import { isValidISODate } from '@capacitylens/shared/lib/integrity'
import { isExternalResource } from '@capacitylens/shared/types/entities'
import { m } from '@/i18n'
import {
  Command,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
} from './ui/command'
import type { Filters } from '../store/useStore'
import { cn } from '@/lib/utils'
import { restoreFocus, wrapTabWithin } from './common/focus'
import { LINKS } from '../lib/navLinks'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PaletteItem {
  id: string
  label: string
  sublabel?: string
  section: string
  onSelect: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const goToToday = useStore((s) => s.goToToday)
  const goToDate = useStore((s) => s.goToDate)
  const jumpToResource = useStore((s) => s.jumpToResource)
  const setFilters = useStore((s) => s.setFilters)
  const data = useActiveScopedData()
  // Scoped `data` has accounts blanked, so read the discipline flag from the full store.
  const disciplinesEnabled = useStore((s) => disciplinesEnabledFor(s.data, s.activeAccountId))
  // Per-account view pref (default OFF): when off, placeholders are not offered as jump targets.
  const placeholdersEnabled = useStore((s) => placeholdersEnabledFor(s.data, s.activeAccountId))
  // Per-account view pref (default OFF): when off, external / 3rd parties are not offered as
  // jump targets — their schedule row is hidden, so jumping to it would scroll to nothing.
  const externalEnabled = useStore((s) => externalEnabledFor(s.data, s.activeAccountId))

  const [query, setQuery] = useState('')
  // cmdk owns highlight/selection by item `value` (we pass each item's id). Controlling it lets us
  // know which row is active so we can drive the input's `aria-activedescendant` (see below); cmdk
  // routes its own pointer/keyboard moves through onValueChange back into this state.
  const [activeValue, setActiveValue] = useState('')

  // Refs into cmdk's input + list so we can repair `aria-activedescendant` (below).
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // Ref onto the dialog panel for the Tab wrap below.
  const panelRef = useRef<HTMLDivElement>(null)
  // Ref onto the backdrop (the palette's own root node in the shell tree) so the inert effect
  // below can find — and later un-inert — its siblings without reaching into AppShell.
  const rootRef = useRef<HTMLDivElement>(null)

  // Unlike the entity-edit Modal (dialogs.tsx), which deliberately leaves the background NOT
  // aria-hidden/inert (an honest reflection that its backdrop doesn't fully occlude, and Escape
  // there can be refused by the dirty-guard), the palette has no legitimate reason to expose
  // background content: it always fully covers the app, and Escape/backdrop-click always close it
  // outright. Make every sibling of the palette's own root `inert` while it's mounted — this is
  // the same primitive ResourceLane's BarsLayer uses to pull the work bars out of the tree in
  // "Time off" mode — so keyboard Tab AND screen-reader browse-mode virtual navigation both stay
  // inside the dialog, not just the Tab-wrap below (which only covers real Tab key presses).
  // Restored on unmount so the app is interactive again the instant the palette closes.
  useEffect(() => {
    const root = rootRef.current
    const parent = root?.parentElement
    if (!root || !parent) return
    const siblings = Array.from(parent.children).filter((el): el is HTMLElement => el !== root && el instanceof HTMLElement)
    for (const el of siblings) el.inert = true
    return () => {
      for (const el of siblings) el.inert = false
    }
  }, [])

  // Focus restore: capture the invoker (whatever had focus when the palette opened — the ⌘K
  // press leaves it on a toolbar button, the grid, etc.) and give focus back on unmount.
  // Same policy as the Modal in common/dialogs.tsx (restoreFocus handles a since-detached
  // invoker by falling back to <main>), so closing any overlay lands keyboard/SR users
  // somewhere sensible instead of dropping focus to <body> (WCAG 2.4.3).
  //
  // ORDERING: the capture must run during RENDER, not in an effect. The CommandInput's
  // `autoFocus` applies at COMMIT — before any passive effect runs — so an effect-time
  // `document.activeElement` read would capture the palette's OWN input (detached by the
  // unmount → restoreFocus falls back to <main>, never the real invoker). A lazy useState
  // initializer runs exactly once, render-phase, before that autoFocus commits.
  const [invoker] = useState(() => document.activeElement as HTMLElement | null)
  // STRICTMODE: dev mounts run setup → cleanup → setup. A synchronous restoreFocus in the cleanup
  // fires on that FAKE unmount — right after the input's autoFocus committed — yanking focus back
  // to the invoker; with focus outside the panel, Escape never reaches the Command's onKeyDown and
  // the palette can't be closed by keyboard (caught by e2e against the StrictMode dev server; the
  // production build has no double-mount). Defer the restore a tick and let a re-running setup
  // cancel it: only a REAL unmount lets the timer fire. restoreFocus itself handles the invoker
  // having been detached in the meantime (falls back to <main>).
  const restoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (restoreTimer.current !== null) {
      clearTimeout(restoreTimer.current) // StrictMode remount — the fake unmount's restore is cancelled
      restoreTimer.current = null
    }
    return () => {
      restoreTimer.current = setTimeout(() => restoreFocus(invoker), 0)
    }
  }, [invoker])

  // Tab containment via the shared wrapTabWithin (common/focus.ts — one wrap shared with the
  // Modal in common/dialogs.tsx so the two overlays can't drift): the palette is visually
  // overlaid on obscured content, so Tab/Shift-Tab must cycle within the panel — otherwise
  // keyboard users tab out into controls they can't see. Usually the input is the only
  // focusable (cmdk options are aria-activedescendant, not tabbable), so the wrap simply
  // keeps focus on it. This is belt-and-braces alongside `aria-modal` + the sibling-`inert`
  // effect above (which already make the background unreachable to both Tab and AT browse
  // mode) — unlike dialogs.tsx's Modal, the palette's backdrop always fully occludes the app,
  // so there's no honesty concern with claiming a true modal here. cmdk's own arrow/Enter
  // handling is untouched — this listener acts on Tab only.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const node = panelRef.current
      if (!node) return
      wrapTabWithin(node, e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Build the full item list (kept verbatim — capacitylens's own fuzzyFilter drives results, not cmdk's
  // internal filter, hence `shouldFilter={false}` below). Memoized so the fuzzy filter over ALL data
  // does NOT re-run on every render: cmdk churns the controlled `value` on each pointer-move (→
  // re-render), and the active-row change must not re-run the filter. Keyed on the real inputs only.
  const items: PaletteItem[] = useMemo(
    () =>
      buildItems({
        query,
        data,
        disciplinesEnabled,
        placeholdersEnabled,
        externalEnabled,
        navigate,
        goToToday,
        goToDate,
        jumpToResource,
        setFilters,
        onClose,
      }),
    [
      query,
      data,
      disciplinesEnabled,
      placeholdersEnabled,
      externalEnabled,
      navigate,
      goToToday,
      goToDate,
      jumpToResource,
      setFilters,
      onClose,
    ],
  )

  // Group items by section for rendering (one CommandGroup per section).
  const sections: { title: string; items: PaletteItem[] }[] = []
  for (const item of items) {
    let sec = sections.find((s) => s.title === item.section)
    if (!sec) {
      sec = { title: item.section, items: [] }
      sections.push(sec)
    }
    sec.items.push(item)
  }

  // Repair the combobox's `aria-activedescendant`. cmdk hardcodes it from its OWN `selectedItemId`,
  // which it fails to populate on the controlled-`value` path (the value-change handler short-circuits
  // once a controlled value is present) — so the input names no active descendant, breaking the
  // combobox SR pattern. cmdk's element ids are its internal `useId`s (we can't pass our own — its
  // `id` wins over props), so we read the active option's real id straight off the DOM and write it
  // onto the input ourselves. cmdk marks exactly ONE option `aria-selected="true"` (the active row),
  // so we match that single option by its selected state — no need to also cross-check `data-value`
  // against our controlled `activeValue` (redundant, and it breaks the auto-selected first row whose
  // value our state hasn't caught up to yet). This runs in a layout effect AFTER cmdk's render
  // commits; React won't clobber it on cmdk's next render because cmdk keeps emitting the same `null`
  // (null → null is a no-op diff), so our value survives until the active row actually changes.
  useLayoutEffect(() => {
    const input = inputRef.current
    const list = listRef.current
    if (!input || !list) return
    const activeOpt = list.querySelector<HTMLElement>('[cmdk-item=""][aria-selected="true"]')
    const activeId = activeOpt?.id ?? null
    if (activeId) {
      input.setAttribute('aria-activedescendant', activeId)
      // The listbox carries the same attribute; keep the two in sync for the full combobox pattern.
      list.setAttribute('aria-activedescendant', activeId)
    } else {
      input.removeAttribute('aria-activedescendant')
      list.removeAttribute('aria-activedescendant')
    }
  })

  return (
    // Backdrop — click outside to close
    <div
      ref={rootRef}
      className="fixed inset-0 z-50 flex justify-center bg-black/40 pt-[15vh] backdrop-blur-sm animate-[capacitylens-fade_0.12s_ease-out]"
      onMouseDown={(e) => {
        // Only close if the mousedown was directly on the backdrop (not bubbled)
        if (e.target === e.currentTarget) onClose()
      }}
      data-testid="command-palette"
      role="presentation"
    >
      <div
        ref={panelRef}
        // The panel is a labelled, TRUE modal dialog: aria-modal (plus the inert siblings set up
        // above) tells AT browse mode the rest of the page really is unreachable while this is open.
        role="dialog"
        aria-modal="true"
        aria-label={m.palette_dialog_label()}
        className="flex h-fit max-h-[60vh] w-full max-w-xl flex-col overflow-hidden rounded-xl bg-elevated shadow-pop ring-1 ring-line animate-[capacitylens-pop_0.14s_ease-out]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Command
          shouldFilter={false}
          loop={false}
          value={activeValue}
          onValueChange={setActiveValue}
          // cmdk doesn't close on Escape itself — wire it here (the keydown fires before cmdk's
          // own arrow/enter switch). Mirror the prior hand-rolled handler's Escape→onClose.
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }
          }}
        >
          {/* Search input row */}
          <div className="flex items-center gap-3 border-b px-4 py-3">
            {/* Magnifying glass icon */}
            <svg
              className="h-4 w-4 shrink-0 text-faint"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <CommandInput
              ref={inputRef}
              autoFocus
              aria-label={m.palette_search_aria()}
              placeholder={m.palette_search_placeholder()}
              value={query}
              onValueChange={setQuery}
              data-testid="command-palette-input"
            />
            <kbd className="hidden rounded border px-1.5 py-0.5 text-xs text-faint sm:block">{m.palette_esc()}</kbd>
          </div>

          {/* Results — cmdk uses its `label` prop (not aria-label) for the listbox's accessible name. */}
          <CommandList ref={listRef} label={m.palette_results_label()}>
            {/* No-results: manual conditional (deterministic with shouldFilter=false) rather than
                cmdk's CommandEmpty, which keys off its internal filtered-count. */}
            {items.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-faint">{m.palette_no_results({ query })}</div>
            )}
            {sections.map((section) => (
              <CommandGroup key={section.title} heading={section.title}>
                {section.items.map((item) => (
                  <CommandItem
                    key={item.id}
                    // Unique value per item so identical labels don't collide in cmdk's selection.
                    value={item.id}
                    // SINGLE selection path: cmdk's onSelect already fires for BOTH a click and Enter.
                    // The earlier extra onMouseDown handler ran onSelect a second time (preventDefault on
                    // mousedown does NOT cancel the following click) — a double-fire masked only by the
                    // synchronous unmount. Hover-activation is likewise cmdk-native (onPointerMove →
                    // onValueChange → setActiveValue), so no manual onMouseEnter either.
                    onSelect={() => item.onSelect()}
                    data-testid="command-palette-option"
                  >
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.sublabel && (
                      /* text-muted on the active brand-soft tint (text-faint fails AA at 4.08:1);
                         text-muted clears 4.5:1 on brand-soft in both light and dark. */
                      <span
                        className={cn('shrink-0 truncate text-xs', item.id === activeValue ? 'text-muted' : 'text-faint')}
                      >
                        {item.sublabel}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </div>
    </div>
  )
}

// ─── Item builder ─────────────────────────────────────────────────────────────

const SECTION_LIMIT = 5 // max results per entity section

function buildItems({
  query,
  data,
  disciplinesEnabled,
  placeholdersEnabled,
  externalEnabled,
  navigate,
  goToToday,
  goToDate,
  jumpToResource,
  setFilters,
  onClose,
}: {
  query: string
  data: ReturnType<typeof useActiveScopedData>
  disciplinesEnabled: boolean
  placeholdersEnabled: boolean
  externalEnabled: boolean
  navigate: ReturnType<typeof useNavigate>
  goToToday: () => void
  goToDate: (iso: string) => void
  jumpToResource: (id: string) => void
  setFilters: (patch: Partial<Filters>) => void
  onClose: () => void
}): PaletteItem[] {
  const q = query.trim()
  const items: PaletteItem[] = []

  // ── Actions ────────────────────────────────────────────────────────────────
  const actions: PaletteItem[] = []

  // "Go to today" — always available in Actions
  actions.push({
    id: 'action-today',
    label: m.palette_action_today(),
    section: m.palette_section_actions(),
    onSelect: () => {
      void navigate('/')
      goToToday()
      onClose()
    },
  })

  // "Go to date YYYY-MM-DD" — appears only when query is a valid ISO date
  if (isValidISODate(q)) {
    actions.push({
      id: `action-date-${q}`,
      label: m.palette_action_date({ date: q }),
      section: m.palette_section_actions(),
      onSelect: () => {
        void navigate('/')
        goToDate(q)
        onClose()
      },
    })
  }

  // Filter actions by query (fuzzy on label)
  const filteredActions = q
    ? fuzzyFilter(actions, q, (a) => a.label).slice(0, SECTION_LIMIT)
    : actions

  // ── Pages ──────────────────────────────────────────────────────────────────
  // Derive page destinations from the same source as both sidebar renderings. New first-class
  // routes therefore cannot silently appear in navigation while being absent from the palette.
  const pages: PaletteItem[] = LINKS
    .filter(([to]) => disciplinesEnabled || to !== '/disciplines')
    .map(([to, label]) => ({
      id: `page-${to === '/' ? 'schedule' : to.slice(1)}`,
      label: label(),
      sublabel: to,
      section: m.palette_section_pages(),
      onSelect: () => {
        void navigate(to)
        onClose()
      },
    }))

  const filteredPages = q
    ? fuzzyFilter(pages, q, (p) => p.label).slice(0, SECTION_LIMIT)
    : pages

  // ── Resources ──────────────────────────────────────────────────────────────
  // Placeholders and externals are each gated behind a per-account pref (both default OFF). When
  // off, drop them as jump targets — their schedule row is hidden, so jumping to it would scroll to
  // nothing.
  const resourceItems: PaletteItem[] = data.resources
    .filter((r) => placeholdersEnabled || r.kind !== 'placeholder')
    .filter((r) => externalEnabled || !isExternalResource(r))
    .map((r) => ({
    id: `res-${r.id}`,
    // External / 3rd parties are jump targets too (they're schedule rows), but mark them so they
    // don't read as one of our own people in the list — mirrors the assignee dropdown's " (external)".
    // A placeholder reads as the literal "Placeholder" with its role as secondary text.
    label: `${resourceDisplayName(r)}${isExternalResource(r) ? m.palette_resource_external_suffix() : ''}`,
    sublabel: r.kind === 'placeholder' ? r.role : r.name ? r.role : undefined,
    section: m.palette_section_people(),
    onSelect: () => {
      void navigate('/')
      jumpToResource(r.id)
      onClose()
    },
  }))

  const filteredResources = q
    ? fuzzyFilter(resourceItems, q, (r) => r.label).slice(0, SECTION_LIMIT)
    : resourceItems.slice(0, SECTION_LIMIT)

  // ── Projects ───────────────────────────────────────────────────────────────
  const projectItems: PaletteItem[] = data.projects.map((p) => {
    const client = data.clients.find((c) => c.id === p.clientId)
    return {
      id: `proj-${p.id}`,
      label: p.name,
      sublabel: client?.name,
      section: m.palette_section_projects(),
      onSelect: () => {
        void navigate('/')
        setFilters({ ...emptyFilters(), projectId: p.id })
        onClose()
      },
    }
  })

  const filteredProjects = q
    ? fuzzyFilter(projectItems, q, (p) => p.label).slice(0, SECTION_LIMIT)
    : projectItems.slice(0, SECTION_LIMIT)

  // ── Clients ────────────────────────────────────────────────────────────────
  const clientItems: PaletteItem[] = data.clients.map((c) => ({
    id: `client-${c.id}`,
    label: c.name,
    section: m.palette_section_clients(),
    onSelect: () => {
      void navigate('/')
      setFilters({ ...emptyFilters(), clientId: c.id })
      onClose()
    },
  }))

  const filteredClients = q
    ? fuzzyFilter(clientItems, q, (c) => c.label).slice(0, SECTION_LIMIT)
    : clientItems.slice(0, SECTION_LIMIT)

  // ── Activities ──────────────────────────────────────────────────────────────────
  const activityItems: PaletteItem[] = data.activities.map((a) => {
    const project = data.projects.find((p) => p.id === a.projectId)
    return {
      id: `activity-${a.id}`,
      label: a.name,
      // Project-specific activities show their project; project-less activities show their kind so the two
      // aren't indistinguishable blank-sublabel rows.
      sublabel: a.kind === 'project' ? project?.name : a.kind === 'internal' ? m.palette_activity_internal() : m.palette_activity_repeatable(),
      section: m.palette_section_activities(),
      onSelect: () => {
        void navigate('/activities')
        onClose()
      },
    }
  })

  const filteredActivities = q
    ? fuzzyFilter(activityItems, q, (a) => a.label).slice(0, SECTION_LIMIT)
    : activityItems.slice(0, SECTION_LIMIT)

  // ── Assemble ───────────────────────────────────────────────────────────────
  // When there's a query, only include sections that have results
  if (q) {
    if (filteredActions.length) items.push(...filteredActions)
    if (filteredPages.length) items.push(...filteredPages)
    if (filteredResources.length) items.push(...filteredResources)
    if (filteredProjects.length) items.push(...filteredProjects)
    if (filteredClients.length) items.push(...filteredClients)
    if (filteredActivities.length) items.push(...filteredActivities)
  } else {
    // No query: show Actions + Pages only
    items.push(...filteredActions)
    items.push(...filteredPages)
  }

  return items
}
