import { useEffect, useRef, useState } from 'react'
import { hasActiveFilters, useStore } from '../../store/useStore'
import { disciplinesEnabledFor } from '../../store/selectors'
import { useScopedData } from '../../store/useScopedData'
import { ZOOM_LEVELS } from '../../lib/schedulerConfig'
import { Button } from '../common/ui'
import { controlBase, selectChevronClass, selectChevronStyle } from '../common/controls'
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

  const activeAccountId = useStore((s) => s.activeAccountId)
  // Hide the discipline filter when the account doesn't use disciplines (buildSchedulerModel
  // also ignores filters.disciplineId in that case, so a stale value can't hide anyone).
  const disciplinesEnabled = useStore((s) => disciplinesEnabledFor(s.data, s.activeAccountId))
  // Debounce the search into the store: each keystroke otherwise rebuilds the whole
  // scheduler model (new filters object → model useMemo) and re-renders every lane.
  // Keep the input snappy locally; push to filters after a short pause.
  const [searchInput, setSearchInput] = useState(filters.search)
  // Adopt external resets/replacements by reconciling during render — the React-recommended
  // alternative to a sync effect. Keyed on the filters OBJECT (identity), NOT the search
  // value: a palette project/client selection REPLACES filters with a fresh object whose
  // search is '' — if the box held a not-yet-debounced term, the search VALUE is '' on both
  // sides of that write, so a value key misses it and leaves stale text in the box. Our own
  // debounce write also makes a new object, but re-syncs to the value it just pushed
  // (a visual no-op). Track the TENANT too, so a half-typed term resets when the company
  // changes (the whole filters object can be reset on both sides of a switch).
  const [seen, setSeen] = useState({ filters, account: activeAccountId })
  if (filters !== seen.filters || activeAccountId !== seen.account) {
    setSeen({ filters, account: activeAccountId })
    setSearchInput(filters.search)
  }
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelSearchTimer = () => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = null
  }
  // Cancel any in-flight debounce when the filters object changes EXTERNALLY (Clear, a
  // palette replacement, account switch) — not just on unmount. Keyed on the OBJECT for
  // the same reason as the reconcile above: the palette race had filters.search unchanged
  // ('' → ''), so a value key left the timer alive to resurrect the stale term over the
  // palette's replacement ~180ms later. The cleanup runs before the next render's effect,
  // so an external write cancels the pending setFilters({search:'old'}) in time. (When our
  // own debounce is what changed filters, the timer has already fired — cancelling is a
  // harmless no-op.)
  useEffect(() => cancelSearchTimer, [filters, activeAccountId])
  const onSearchChange = (v: string) => {
    setSearchInput(v)
    cancelSearchTimer()
    // The filters object the user was typing against. The effect-cleanup cancel above is
    // not enough on its own: effects flush after paint, and an external replacement (the
    // palette) triggers the expensive scheduler-model rebuild — under load the timer can
    // fire BEFORE the cleanup runs and resurrect the stale term over the replacement. So
    // the write also guards at FIRE time: if filters moved underneath the pending term,
    // it's stale — drop it.
    const armedOn = useStore.getState().ui.filters
    searchTimer.current = setTimeout(() => {
      if (useStore.getState().ui.filters !== armedOn) return
      setFilters({ search: v })
    }, 180)
  }
  // Clear must also kill any in-flight debounce + reset the local box — otherwise an
  // orphaned timer re-applies a just-cleared term (and the render reconcile can't catch
  // it when filters.search was already '').
  const onClear = () => {
    cancelSearchTimer()
    setSearchInput('')
    clearFilters()
  }

  return (
    <div className="@container border-b border-line bg-surface">
      <div className="flex items-center gap-2 px-4 py-2">
        <div className="mr-auto flex items-center gap-1">
          <h1 className="text-xl font-semibold">Schedule</h1>
          {/* Undo/redo buttons hidden for now (still on ⌘Z / ⌘⇧Z via AppShell). See DECISIONS.md. */}
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
        {disciplinesEnabled && (
          <select
            aria-label="Filter by discipline"
            className={`${controlBase} ${selectChevronClass}`}
            style={selectChevronStyle}
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
        )}
        <select
          aria-label="Filter by client"
          className={`${controlBase} ${selectChevronClass}`}
          style={selectChevronStyle}
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
          className={`${controlBase} ${selectChevronClass}`}
          style={selectChevronStyle}
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
          <Button variant="ghost" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>
    </div>
  )
}
