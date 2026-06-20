import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore, emptyFilters } from '../store/useStore'
import { disciplinesEnabledFor } from '../store/selectors'
import { useScopedData } from '../store/useScopedData'
import { fuzzyFilter } from '../lib/fuzzy'
import { isValidISODate } from '@floaty/shared/lib/integrity'
import { isExternalResource } from '@floaty/shared/types/entities'
import type { Filters } from '../store/useStore'

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
  const data = useScopedData()
  // Scoped `data` has accounts blanked, so read the discipline flag from the full store.
  const disciplinesEnabled = useStore((s) => disciplinesEnabledFor(s.data, s.activeAccountId))

  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const listboxId = useId()

  // Focus the input when the palette opens
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Build the full item list
  const items: PaletteItem[] = buildItems({
    query,
    data,
    disciplinesEnabled,
    navigate,
    goToToday,
    goToDate,
    jumpToResource,
    setFilters,
    onClose,
  })

  // Clamp activeIndex to the current list length (derived, no effect needed).
  const clampedIndex = items.length > 0 ? Math.min(activeIndex, items.length - 1) : 0

  const activeId = items[clampedIndex] ? `cp-option-${items[clampedIndex].id}` : undefined

  // Keyboard navigation
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (items[clampedIndex]) items[clampedIndex].onSelect()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  // Scroll active option into view (guarded: jsdom does not implement scrollIntoView)
  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>('[aria-selected="true"]')
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
  }, [clampedIndex])

  // Group items by section for rendering
  const sections: { title: string; items: PaletteItem[] }[] = []
  for (const item of items) {
    let sec = sections.find((s) => s.title === item.section)
    if (!sec) {
      sec = { title: item.section, items: [] }
      sections.push(sec)
    }
    sec.items.push(item)
  }

  // Flat index into `items` (for aria-activedescendant tracking)
  let globalIdx = 0

  return (
    // Backdrop — click outside to close
    <div
      className="fixed inset-0 z-50 flex justify-center bg-black/40 pt-[15vh] backdrop-blur-sm animate-[floaty-fade_0.12s_ease-out]"
      onMouseDown={(e) => {
        // Only close if the mousedown was directly on the backdrop (not bubbled)
        if (e.target === e.currentTarget) onClose()
      }}
      data-testid="command-palette"
      role="presentation"
    >
      <div
        className="flex h-fit max-h-[60vh] w-full max-w-xl flex-col overflow-hidden rounded-xl bg-elevated shadow-pop ring-1 ring-line animate-[floaty-pop_0.14s_ease-out]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Search input */}
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
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={items.length > 0}
            aria-controls={listboxId}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-label="Search pages, people, projects…"
            placeholder="Search pages, people, projects…"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-faint focus:outline-none"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActiveIndex(0)
            }}
            onKeyDown={onKeyDown}
            data-testid="command-palette-input"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden rounded border px-1.5 py-0.5 text-xs text-faint sm:block">esc</kbd>
        </div>

        {/* Results */}
        <ul
          id={listboxId}
          ref={listRef}
          role="listbox"
          aria-label="Command palette results"
          className="overflow-y-auto py-1"
        >
          {items.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-faint" role="option" aria-selected={false}>
              No results for "{query}"
            </li>
          )}
          {sections.map((section) => (
            <li key={section.title} role="presentation">
              <div className="px-3 pb-1 pt-3 text-2xs font-semibold uppercase tracking-wide text-faint">
                {section.title}
              </div>
              <ul role="presentation">
                {section.items.map((item) => {
                  const idx = globalIdx++
                  const isActive = idx === clampedIndex
                  return (
                    <li
                      key={item.id}
                      id={`cp-option-${item.id}`}
                      role="option"
                      aria-selected={isActive}
                      data-testid="command-palette-option"
                      className={`flex cursor-pointer items-center gap-3 px-4 py-2 text-sm transition-colors ${
                        isActive ? 'bg-brand-soft text-ink' : 'text-ink hover:bg-canvas'
                      }`}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onMouseDown={(e) => {
                        e.preventDefault() // don't blur the input
                        item.onSelect()
                      }}
                    >
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.sublabel && (
                        /* Use text-muted on active background (brand-soft) — text-faint fails AA at 4.08:1.
                           text-muted clears 4.5:1 on the brand-soft tint in both light and dark. */
                        <span className={`shrink-0 truncate text-xs ${isActive ? 'text-muted' : 'text-faint'}`}>{item.sublabel}</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
        </ul>
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
  navigate,
  goToToday,
  goToDate,
  jumpToResource,
  setFilters,
  onClose,
}: {
  query: string
  data: ReturnType<typeof useScopedData>
  disciplinesEnabled: boolean
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
    label: 'Go to today',
    section: 'Actions',
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
      label: `Go to date ${q}`,
      section: 'Actions',
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
  const pages: PaletteItem[] = [
    { id: 'page-schedule', label: 'Schedule', sublabel: '/', section: 'Pages', onSelect: () => { void navigate('/'); onClose() } },
    { id: 'page-resources', label: 'Resources', sublabel: '/resources', section: 'Pages', onSelect: () => { void navigate('/resources'); onClose() } },
    { id: 'page-external', label: 'External', sublabel: '/external', section: 'Pages', onSelect: () => { void navigate('/external'); onClose() } },
    // Disciplines page entry only when the account uses disciplines (route is guarded too).
    ...(disciplinesEnabled
      ? [{ id: 'page-disciplines', label: 'Disciplines', sublabel: '/disciplines', section: 'Pages', onSelect: () => { void navigate('/disciplines'); onClose() } } as PaletteItem]
      : []),
    { id: 'page-clients', label: 'Clients', sublabel: '/clients', section: 'Pages', onSelect: () => { void navigate('/clients'); onClose() } },
    { id: 'page-projects', label: 'Projects', sublabel: '/projects', section: 'Pages', onSelect: () => { void navigate('/projects'); onClose() } },
    { id: 'page-tasks', label: 'Tasks', sublabel: '/tasks', section: 'Pages', onSelect: () => { void navigate('/tasks'); onClose() } },
    { id: 'page-timeoff', label: 'Time off', sublabel: '/timeoff', section: 'Pages', onSelect: () => { void navigate('/timeoff'); onClose() } },
    { id: 'page-settings', label: 'Settings', sublabel: '/settings', section: 'Pages', onSelect: () => { void navigate('/settings'); onClose() } },
  ]

  const filteredPages = q
    ? fuzzyFilter(pages, q, (p) => p.label).slice(0, SECTION_LIMIT)
    : pages

  // ── Resources ──────────────────────────────────────────────────────────────
  const resourceItems: PaletteItem[] = data.resources.map((r) => ({
    id: `res-${r.id}`,
    // External / 3rd parties are jump targets too (they're schedule rows), but mark them so they
    // don't read as one of our own people in the list — mirrors the assignee dropdown's " (external)".
    label: `${r.name ?? r.role}${isExternalResource(r) ? ' (external)' : ''}`,
    sublabel: r.name ? r.role : undefined,
    section: 'People',
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
      section: 'Projects',
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
    section: 'Clients',
    onSelect: () => {
      void navigate('/')
      setFilters({ ...emptyFilters(), clientId: c.id })
      onClose()
    },
  }))

  const filteredClients = q
    ? fuzzyFilter(clientItems, q, (c) => c.label).slice(0, SECTION_LIMIT)
    : clientItems.slice(0, SECTION_LIMIT)

  // ── Tasks ──────────────────────────────────────────────────────────────────
  const taskItems: PaletteItem[] = data.tasks.map((t) => {
    const project = data.projects.find((p) => p.id === t.projectId)
    return {
      id: `task-${t.id}`,
      label: t.name,
      // Project tasks show their project; project-less tasks show their kind so the two
      // aren't indistinguishable blank-sublabel rows.
      sublabel: t.kind === 'project' ? project?.name : t.kind === 'internal' ? 'Internal' : 'Repeatable',
      section: 'Tasks',
      onSelect: () => {
        void navigate('/tasks')
        onClose()
      },
    }
  })

  const filteredTasks = q
    ? fuzzyFilter(taskItems, q, (t) => t.label).slice(0, SECTION_LIMIT)
    : taskItems.slice(0, SECTION_LIMIT)

  // ── Assemble ───────────────────────────────────────────────────────────────
  // When there's a query, only include sections that have results
  if (q) {
    if (filteredActions.length) items.push(...filteredActions)
    if (filteredPages.length) items.push(...filteredPages)
    if (filteredResources.length) items.push(...filteredResources)
    if (filteredProjects.length) items.push(...filteredProjects)
    if (filteredClients.length) items.push(...filteredClients)
    if (filteredTasks.length) items.push(...filteredTasks)
  } else {
    // No query: show Actions + Pages only
    items.push(...filteredActions)
    items.push(...filteredPages)
  }

  return items
}
