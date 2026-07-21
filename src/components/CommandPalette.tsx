import { useMemo, useRef, useState, useLayoutEffect } from 'react'
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
import { LINKS } from '../lib/navLinks'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'

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
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        data-testid="command-palette"
        overlayProps={{
          'data-testid': 'command-palette-overlay',
          onMouseDown: (event) => { event.preventDefault(); onClose() },
        }}
        showCloseButton={false}
        aria-describedby={undefined}
        className="top-[15vh] max-h-[60vh] max-w-xl translate-y-0 gap-0 overflow-hidden p-0"
      >
        <DialogTitle className="sr-only">{m.palette_dialog_label()}</DialogTitle>
        <Command
          shouldFilter={false}
          loop={false}
          value={activeValue}
          onValueChange={setActiveValue}
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
      </DialogContent>
    </Dialog>
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
  // Derive page destinations from the same source as the sidebar navigation. New first-class
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
