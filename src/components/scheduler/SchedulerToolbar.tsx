import { useEffect, useRef, useState } from 'react'
import { hasActiveFilters, useStore } from '../../store/useStore'
import { useScopedData } from '../../store/useScopedData'
import { ZOOM_LEVELS } from '../../lib/schedulerConfig'
import { Button, controlBase } from '../common/ui'
import { Icon } from '../common/Icon'

export function SchedulerToolbar() {
  const zoom = useStore((s) => s.ui.zoom)
  const setZoom = useStore((s) => s.setZoom)
  const panDays = useStore((s) => s.panDays)
  const goToToday = useStore((s) => s.goToToday)
  const goToDate = useStore((s) => s.goToDate)
  const focusDate = useStore((s) => s.ui.focusDate)
  const drawMode = useStore((s) => s.ui.drawMode)
  const setDrawMode = useStore((s) => s.setDrawMode)
  const filters = useStore((s) => s.ui.filters)
  const setFilters = useStore((s) => s.setFilters)
  const clearFilters = useStore((s) => s.clearFilters)
  const data = useScopedData()
  const disciplines = data.disciplines
  const clients = data.clients
  const projects = data.projects
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)

  // Debounce the search into the store: each keystroke otherwise rebuilds the whole
  // scheduler model (new filters object → model useMemo) and re-renders every lane.
  // Keep the input snappy locally; push to filters after a short pause.
  const [searchInput, setSearchInput] = useState(filters.search)
  // Adopt external changes to filters.search (Clear button, account switch) by
  // reconciling during render — the React-recommended alternative to a sync effect.
  const [seenSearch, setSeenSearch] = useState(filters.search)
  if (filters.search !== seenSearch) {
    setSeenSearch(filters.search)
    setSearchInput(filters.search)
  }
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current) }, [])
  const onSearchChange = (v: string) => {
    setSearchInput(v)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setFilters({ search: v }), 180)
  }

  return (
    <div className="@container border-b border-line bg-surface">
      <div className="flex items-center gap-2 px-4 py-2">
        <div className="mr-auto flex items-center gap-1">
          <h1 className="text-xl font-semibold">Schedule</h1>
          <Button variant="ghost" onClick={undo} disabled={!canUndo} title="Undo (⌘Z)" ariaLabel="Undo">
            <Icon name="undo" />
          </Button>
          <Button variant="ghost" onClick={redo} disabled={!canRedo} title="Redo (⌘⇧Z)" ariaLabel="Redo">
            <Icon name="redo" />
          </Button>
        </div>
        <Button variant="ghost" onClick={() => panDays(-7)} title="Back one week">
          <Icon name="chevron-left" /> Prev
        </Button>
        <Button variant="ghost" onClick={goToToday}>
          Today
        </Button>
        <Button variant="ghost" onClick={() => panDays(7)} title="Forward one week">
          Next <Icon name="chevron-right" />
        </Button>
        <input
          type="date"
          value={focusDate}
          onChange={(e) => e.target.value && goToDate(e.target.value)}
          aria-label="Jump to date"
          title="Jump to date"
          className={controlBase}
        />
        <div className="ml-2 flex overflow-hidden rounded-md border border-line" role="group" aria-label="Weeks visible">
          {ZOOM_LEVELS.map((w) => (
            <button
              key={w}
              type="button"
              aria-pressed={zoom === w}
              onClick={() => setZoom(w)}
              title={`${w} week${w > 1 ? 's' : ''} visible`}
              className={`px-2.5 py-1 text-sm transition ${zoom === w ? 'bg-brand-strong text-white' : 'bg-surface text-ink hover:bg-canvas'}`}
            >
              {w}w
            </button>
          ))}
        </div>
        <div className="flex overflow-hidden rounded-md border border-line" role="group" aria-label="Draw mode">
          {(['work', 'timeoff'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={drawMode === m}
              onClick={() => setDrawMode(m)}
              title={m === 'work' ? 'Draw allocations' : 'Draw time off'}
              className={`px-2.5 py-1 text-sm transition ${drawMode === m ? 'bg-brand-strong text-white' : 'bg-surface text-ink hover:bg-canvas'}`}
            >
              {m === 'work' ? 'Work' : 'Time off'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 pb-2 text-sm">
        <input
          value={searchInput}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search people…"
          aria-label="Search people"
          className={`${controlBase} w-44 @max-[680px]:w-full`}
        />
        <select
          aria-label="Filter by discipline"
          className={controlBase}
          value={filters.disciplineId ?? ''}
          onChange={(e) => setFilters({ disciplineId: e.target.value || null })}
        >
          <option value="">All disciplines</option>
          {disciplines.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by client"
          className={controlBase}
          value={filters.clientId ?? ''}
          onChange={(e) => setFilters({ clientId: e.target.value || null })}
        >
          <option value="">All clients</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by project"
          className={controlBase}
          value={filters.projectId ?? ''}
          onChange={(e) => setFilters({ projectId: e.target.value || null })}
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-muted">
          <input type="checkbox" checked={filters.hideTentative} onChange={(e) => setFilters({ hideTentative: e.target.checked })} />
          Hide tentative
        </label>
        {(filters.projectId || filters.clientId) && (
          <label className="flex items-center gap-1.5 text-muted" title="Show resources with no work on this project (dimmed) so you can staff them">
            <input type="checkbox" checked={filters.showUnmatched} onChange={(e) => setFilters({ showUnmatched: e.target.checked })} />
            Show unallocated
          </label>
        )}
        {hasActiveFilters(filters) && (
          <Button variant="ghost" onClick={clearFilters}>
            Clear
          </Button>
        )}
      </div>
    </div>
  )
}
