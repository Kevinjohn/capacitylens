import { hasActiveFilters, useStore } from '../../store/useStore'
import { ZOOM_LEVELS } from '../../lib/schedulerConfig'
import { Button } from '../common/ui'

const selectClass = 'rounded-md border bg-surface px-2 py-1 text-sm text-ink'

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
  const disciplines = useStore((s) => s.data.disciplines)
  const clients = useStore((s) => s.data.clients)
  const projects = useStore((s) => s.data.projects)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)

  return (
    <div className="@container border-b border-line bg-surface">
      <div className="flex items-center gap-2 px-4 py-2">
        <div className="mr-auto flex items-center gap-1">
          <h1 className="text-xl font-semibold">Schedule</h1>
          <Button variant="ghost" onClick={undo} disabled={!canUndo} title="Undo (⌘Z)" ariaLabel="Undo">
            ↶
          </Button>
          <Button variant="ghost" onClick={redo} disabled={!canRedo} title="Redo (⌘⇧Z)" ariaLabel="Redo">
            ↷
          </Button>
        </div>
        <Button variant="ghost" onClick={() => panDays(-7)} title="Back one week">
          ‹ Prev
        </Button>
        <Button variant="ghost" onClick={goToToday}>
          Today
        </Button>
        <Button variant="ghost" onClick={() => panDays(7)} title="Forward one week">
          Next ›
        </Button>
        <input
          type="date"
          value={focusDate}
          onChange={(e) => e.target.value && goToDate(e.target.value)}
          aria-label="Jump to date"
          title="Jump to date"
          className="rounded-md border bg-surface px-2 py-1 text-sm text-ink"
        />
        <div className="ml-2 flex overflow-hidden rounded-md border border-line" role="group" aria-label="Weeks visible">
          {ZOOM_LEVELS.map((w) => (
            <button
              key={w}
              type="button"
              aria-pressed={zoom === w}
              onClick={() => setZoom(w)}
              title={`${w} week${w > 1 ? 's' : ''} visible`}
              className={`px-2.5 py-1 text-sm transition ${zoom === w ? 'bg-brand-strong text-white' : 'bg-surface text-ink hover:bg-base'}`}
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
              className={`px-2.5 py-1 text-sm transition ${drawMode === m ? 'bg-brand-strong text-white' : 'bg-surface text-ink hover:bg-base'}`}
            >
              {m === 'work' ? 'Work' : 'Time off'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 pb-2 text-sm">
        <input
          value={filters.search}
          onChange={(e) => setFilters({ search: e.target.value })}
          placeholder="Search people…"
          aria-label="Search people"
          className="w-44 rounded-md border bg-surface px-2 py-1 text-ink placeholder:text-faint @max-[680px]:w-full"
        />
        <select
          aria-label="Filter by discipline"
          className={selectClass}
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
          className={selectClass}
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
          className={selectClass}
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
        {hasActiveFilters(filters) && (
          <Button variant="ghost" onClick={clearFilters}>
            Clear
          </Button>
        )}
      </div>
    </div>
  )
}
