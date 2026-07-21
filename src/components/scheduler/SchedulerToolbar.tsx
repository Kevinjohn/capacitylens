import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Redo2, Undo2 } from 'lucide-react'
import { m } from '@/i18n'
import { hasActiveFilters, useStore } from '../../store/useStore'
import { useCanEdit } from '../../auth/permissionContext'
import { disciplinesEnabledFor } from '../../store/selectors'
import { useActiveScopedData } from '../../store/useScopedData'
import { ZOOM_LEVELS } from '../../lib/schedulerConfig'
import { SegmentedControl } from '../common/ui'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { Field, FieldLabel } from '../ui/field'
import { Input } from '../ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '../ui/select'

export function SchedulerToolbar() {
  // Viewer read-only (P1.12): a viewer has nothing to draw / mutate / undo, so the draw-mode toggle
  // and Undo/Redo are hidden. Navigation + filters (reads) stay. null/owner/admin/editor (incl.
  // OFF/local) → all affordances shown, byte-identical to today.
  const canEdit = useCanEdit()
  const zoom = useStore((s) => s.ui.zoom)
  const setZoom = useStore((s) => s.setZoom)
  const panDays = useStore((s) => s.panDays)
  const goToToday = useStore((s) => s.goToToday)
  const goToDate = useStore((s) => s.goToDate)
  const focusDate = useStore((s) => s.ui.focusDate)
  const drawMode = useStore((s) => s.ui.drawMode)
  const setDrawMode = useStore((s) => s.setDrawMode)
  // Undo/redo is global (the ⌘Z/⌘⇧Z handler lives in AppShell) but its visible affordance lives
  // here on the schedule toolbar — the main editing surface. Enabled off the history stacks.
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const filters = useStore((s) => s.ui.filters)
  const setFilters = useStore((s) => s.setFilters)
  const clearFilters = useStore((s) => s.clearFilters)
  const data = useActiveScopedData()
  const disciplines = data.disciplines
  const clients = data.clients
  const projects = data.projects
  // The activity lens covers only the project-LESS kinds — project-specific activities are reached via the
  // Projects dropdown above.
  const internalActivities = data.activities.filter((t) => t.kind === 'internal')
  const repeatableActivities = data.activities.filter((t) => t.kind === 'repeatable')

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
    <div data-testid="scheduler-toolbar" className="@container border-b border-line bg-surface">
      {/* flex-wrap (mirrors the filters row below): at ~320 CSS px the title + nav + date + zoom +
          draw + undo/redo would otherwise pack onto one non-wrapping line and force horizontal
          scroll, failing WCAG 1.4.10 Reflow. Wrapping lets the chrome reflow into stacked lines
          instead. The gap/padding are unchanged, so wider viewports look identical. */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2">
        <div className="mr-auto flex items-center gap-1">
          <h1 className="text-xl font-semibold">{m.scheduler_title()}</h1>
        </div>
        <Button size="sm" variant="outline" onClick={() => panDays(-7)} title={m.scheduler_nav_prev_title()}>
          <ChevronLeft data-icon="inline-start" /> {m.scheduler_nav_prev()}
        </Button>
        <Button size="sm" variant="outline" onClick={goToToday}>
          {m.scheduler_nav_today()}
        </Button>
        <Button size="sm" variant="outline" onClick={() => panDays(7)} title={m.scheduler_nav_next_title()}>
          {m.scheduler_nav_next()} <ChevronRight data-icon="inline-end" />
        </Button>
        <Input
          type="date"
          value={focusDate}
          onChange={(e) => e.target.value && goToDate(e.target.value)}
          aria-label={m.scheduler_jump_to_date()}
          title={m.scheduler_jump_to_date()}
          className="w-auto"
        />
        <SegmentedControl
          className="ml-2"
          ariaLabel={m.scheduler_weeks_visible_aria()}
          value={zoom}
          onChange={setZoom}
          options={ZOOM_LEVELS.map((w) => ({
            value: w,
            label: m.scheduler_zoom_week_label({ count: w }),
            title: w > 1 ? m.scheduler_weeks_visible_title_other({ count: w }) : m.scheduler_weeks_visible_title_one({ count: w }),
          }))}
        />
        {/* Draw-mode toggle + Undo/Redo: editor-only (P1.12). A viewer can't draw or mutate, so the
            draw toggle and the undo/redo affordances are hidden (nothing to switch / undo). */}
        {canEdit && (
          <>
            <SegmentedControl
              ariaLabel={m.scheduler_draw_mode_aria()}
              value={drawMode}
              onChange={setDrawMode}
              options={[
                { value: 'work', label: m.scheduler_draw_work(), title: m.scheduler_draw_work_title() },
                { value: 'timeoff', label: m.scheduler_draw_timeoff(), title: m.scheduler_draw_timeoff_title() },
              ]}
            />
            {/* Visible counterparts to the global undo/redo shortcuts. */}
            <div className="ml-2 flex items-center gap-1 border-l border-line pl-2">
              <Button
                size="icon-sm"
                variant="outline"
                onClick={undo}
                disabled={!canUndo}
                aria-label={m.scheduler_undo()}
                title={m.scheduler_undo_title()}
                data-testid="undo-button"
              >
                <Undo2 />
              </Button>
              <Button
                size="icon-sm"
                variant="outline"
                onClick={redo}
                disabled={!canRedo}
                aria-label={m.scheduler_redo()}
                title={m.scheduler_redo_title()}
                data-testid="redo-button"
              >
                <Redo2 />
              </Button>
            </div>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 pb-2 text-sm">
        <Input
          value={searchInput}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={m.scheduler_search_people_placeholder()}
          aria-label={m.scheduler_search_people_aria()}
          className="w-44 @max-[680px]:w-full"
        />
        {disciplinesEnabled && (
          <Select
            value={filters.disciplineId ?? 'all'}
            onValueChange={(value) => setFilters({ disciplineId: value === 'all' ? null : value })}
          >
            <SelectTrigger aria-label={m.scheduler_filter_discipline_aria()} className="w-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">{m.scheduler_filter_all_disciplines()}</SelectItem>
                {disciplines.map((discipline) => (
                  <SelectItem key={discipline.id} value={discipline.id}>{discipline.name}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
        <Select value={filters.clientId ?? 'all'} onValueChange={(value) => setFilters({ clientId: value === 'all' ? null : value })}>
          <SelectTrigger aria-label={m.scheduler_filter_client_aria()} className="w-auto"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">{m.scheduler_filter_all_clients()}</SelectItem>
              {clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select value={filters.projectId ?? 'all'} onValueChange={(value) => setFilters({ projectId: value === 'all' ? null : value })}>
          <SelectTrigger aria-label={m.scheduler_filter_project_aria()} className="w-auto"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">{m.scheduler_filter_all_projects()}</SelectItem>
              {projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}
            </SelectGroup>
          </SelectContent>
        </Select>
        {(internalActivities.length > 0 || repeatableActivities.length > 0) && (
          <Select
            // Encoded value: 'all' = all, 'kind:internal'/'kind:repeatable' = a whole group,
            // otherwise a specific activity id. An activityKind selection wins over a stale activityId.
            value={filters.activityKind ? `kind:${filters.activityKind}` : (filters.activityId ?? 'all')}
            onValueChange={(value) => {
              if (value === 'kind:internal') setFilters({ activityKind: 'internal', activityId: null })
              else if (value === 'kind:repeatable') setFilters({ activityKind: 'repeatable', activityId: null })
              else setFilters({ activityId: value === 'all' ? null : value, activityKind: null })
            }}
          >
            <SelectTrigger aria-label={m.scheduler_filter_activity_aria()} className="w-auto"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">{m.scheduler_filter_all_activities()}</SelectItem>
              </SelectGroup>
              {internalActivities.length > 0 && (
                <SelectGroup>
                  <SelectLabel>{m.scheduler_filter_internal_group()}</SelectLabel>
                  <SelectItem value="kind:internal">{m.scheduler_filter_internal_all()}</SelectItem>
                  {internalActivities.map((activity) => <SelectItem key={activity.id} value={activity.id}>{activity.name}</SelectItem>)}
                </SelectGroup>
              )}
              {repeatableActivities.length > 0 && (
                <SelectGroup>
                  <SelectLabel>{m.scheduler_filter_repeatable_group()}</SelectLabel>
                  <SelectItem value="kind:repeatable">{m.scheduler_filter_repeatable_all()}</SelectItem>
                  {repeatableActivities.map((activity) => <SelectItem key={activity.id} value={activity.id}>{activity.name}</SelectItem>)}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
        )}
        <Field orientation="horizontal" className="w-auto gap-1.5">
          <Checkbox id="hide-tentative" checked={filters.hideTentative} onCheckedChange={(checked) => setFilters({ hideTentative: checked === true })} />
          <FieldLabel htmlFor="hide-tentative">{m.scheduler_hide_tentative()}</FieldLabel>
        </Field>
        {(filters.projectId || filters.clientId || filters.activityId || filters.activityKind) && (
          <Field orientation="horizontal" className="w-auto gap-1.5" title={m.scheduler_show_unallocated_title()}>
            <Checkbox id="show-unmatched" checked={filters.showUnmatched} onCheckedChange={(checked) => setFilters({ showUnmatched: checked === true })} />
            <FieldLabel htmlFor="show-unmatched">{m.scheduler_show_unallocated()}</FieldLabel>
          </Field>
        )}
        {hasActiveFilters(filters) && (
          <Button size="sm" variant="outline" onClick={onClear}>
            {m.scheduler_clear()}
          </Button>
        )}
      </div>
    </div>
  )
}
