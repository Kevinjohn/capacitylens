import { laneTop, packLanes, rowHeightForLanes } from '../../lib/lanePacking'
import { capacityForWindow, dayCapacity } from '../../lib/capacity'
import { resolveBarColor } from '@floaty/shared/lib/color'
import { TIME_OFF_TYPE_LABELS } from '../../lib/metadata'
import { externalBand, resourcesByDiscipline, type DisciplineGroup } from '../../store/selectors'
import { isCapacityTracked, isExternalResource } from '@floaty/shared/types/entities'
import { NEUTRAL_COLOR } from '../../lib/palette'
import { laneLayout } from './layout'
import type { ColumnGeometry } from './columnGeometry'
import type { Filters } from '../../store/useStore'
import type { Allocation, AppData, ID, ISODate, Resource, TimeOff } from '@floaty/shared/types/entities'

// Pure view-model builder for the scheduler: turns the dataset + window + filters
// into positioned bars, per-day capacity states, time-off blocks and utilisation,
// grouped by discipline. No React — independently unit-testable.
//
// The model OWNS the shapes the view renders (one-way data -> model -> view), so
// these live here and the presentational components import them from the model —
// not the other way round.

/** A positioned allocation bar. */
export interface BarLayout {
  allocation: Allocation
  x: number
  width: number
  top: number
  color: string
  label: string
  project?: string
  client?: string
  /** True when the assignee is an external / 3rd-party resource — the bar hides its hours. */
  external: boolean
}

/** Per-day capacity state for a lane background cell. */
export interface DayState {
  over: boolean
  unavailable: boolean
}

/** A positioned time-off block. */
export interface TimeOffBlock {
  id: ID
  x: number
  width: number
  label: string
  note?: string
}

export interface RowModel {
  resource: Resource
  rowHeight: number
  bars: BarLayout[]
  dayStates: DayState[]
  timeOff: TimeOffBlock[]
  utilization: number
  overSoon: boolean // over-allocated on at least one day inside the utilisation window
  dimmed: boolean // no work on the active project/client filter — shown for staffing context
}

export interface GroupModel {
  key: string
  title: string
  color?: string
  /** True for the external / 3rd-party band. The view reads THIS (not the key string) to keep the
   *  band's header in flat mode and to suppress its utilisation average. */
  external: boolean
  rows: RowModel[]
}

export function buildSchedulerModel(
  data: AppData,
  // Per-column pixel geometry (built once in SchedulerGrid). Owns the date→x / range→width
  // math so bars line up with the header even when weekend columns are narrowed; replaces the
  // old uniform `origin` + `dayWidth` scalars. Its origin (days[0]) === ui.originDate.
  geom: ColumnGeometry,
  days: ISODate[],
  // The utilisation window is deliberately decoupled from `days`: per-day states
  // span the whole visible timeline, but the headline % is a fixed near-term
  // window (see UTILIZATION_WINDOW_DAYS) so overbooking isn't averaged away.
  utilStart: ISODate,
  utilEnd: ISODate,
  filters: Filters,
  // When false (account.disciplinesEnabled === false) the schedule renders FLAT: one
  // synthetic group holding every resource (no discipline bands), and the discipline
  // filter is ignored. SchedulerGrid skips the group-header row for the flat group.
  disciplinesEnabled: boolean,
): GroupModel[] {
  const search = filters.search.trim().toLowerCase()
  const projectById = new Map(data.projects.map((p) => [p.id, p]))
  const clientById = new Map(data.clients.map((c) => [c.id, c]))
  const taskById = new Map(data.tasks.map((t) => [t.id, t]))
  const resourceById = new Map(data.resources.map((r) => [r.id, r]))
  // Reused for every bar's colour (project → client → resource → grey fallback).
  const colorMaps = { tasks: taskById, projects: projectById, clients: clientById, resources: resourceById }
  const taskMeta = new Map(
    data.tasks.map((t) => {
      // Internal/repeatable (no-project) tasks resolve to no project/client. `kind` feeds the
      // task lens ('Internal — All' / 'Repeatable — All') without a second task lookup.
      const project = t.projectId ? projectById.get(t.projectId) : undefined
      return [t.id, { projectId: t.projectId, clientId: project?.clientId, kind: t.kind }]
    }),
  )
  // Group allocations / time off by resource ONCE up front, so building each row
  // is a Map lookup instead of a full-array scan per resource (was O(resources ×
  // (allocations + timeOff)); now O(allocations + timeOff + resources)).
  const allocsByResource = new Map<ID, Allocation[]>()
  for (const a of data.allocations) {
    const list = allocsByResource.get(a.resourceId)
    if (list) list.push(a)
    else allocsByResource.set(a.resourceId, [a])
  }
  const timeOffByResource = new Map<ID, TimeOff[]>()
  for (const t of data.timeOff) {
    const list = timeOffByResource.get(t.resourceId)
    if (list) list.push(t)
    else timeOffByResource.set(t.resourceId, [t])
  }

  const projectClientActive = !!(filters.projectId || filters.clientId)
  // Does this allocation match the active project/client filter (ignoring tentative)?
  const matchesProjectClient = (a: Allocation): boolean => {
    const meta = taskMeta.get(a.taskId)
    if (filters.projectId && meta?.projectId !== filters.projectId) return false
    if (filters.clientId && meta?.clientId !== filters.clientId) return false
    return true
  }
  // The task lens (standalone — mutually exclusive with project/client via setFilters): a
  // specific internal/repeatable task, or a whole kind ('Internal — All' / 'Repeatable — All').
  const taskFilterActive = !!(filters.taskId || filters.taskKind)
  const matchesTask = (a: Allocation): boolean => {
    if (filters.taskId) return a.taskId === filters.taskId
    if (filters.taskKind) return taskMeta.get(a.taskId)?.kind === filters.taskKind
    return true
  }
  // Any "what work" filter is active — drives the dimmed / show-unmatched staffing view, which
  // is identical whether the active lens is client/project or task.
  const workFilterActive = projectClientActive || taskFilterActive
  const notTentativeHidden = (a: Allocation): boolean => !(filters.hideTentative && a.status === 'tentative')
  const allocVisible = (a: Allocation): boolean =>
    matchesProjectClient(a) && matchesTask(a) && notTentativeHidden(a)
  const resourceVisible = (r: Resource): boolean => {
    if (disciplinesEnabled && filters.disciplineId && r.disciplineId !== filters.disciplineId) return false
    if (search && !`${r.name ?? ''} ${r.role}`.toLowerCase().includes(search)) return false
    return true
  }

  // Disciplines on → group by discipline (ungrouped bucket, then the external band, last). Off →
  // one flat group of every NON-external resource, with the external band STILL trailing (the band
  // is required regardless of disciplines on/off). SchedulerGrid renders the flat group without a
  // header but still draws the external band's header. Build the flat groups LAZILY so the common
  // disciplines-on path doesn't scan resources for a value it discards.
  const groups = disciplinesEnabled
    ? resourcesByDiscipline(data)
    : (() => {
        const flat: DisciplineGroup[] = [{ discipline: null, resources: data.resources.filter(isCapacityTracked) }]
        const band = externalBand(data.resources)
        if (band) flat.push(band)
        return flat
      })()
  return groups
    .map((group) => ({
      key: group.external ? 'external' : (group.discipline?.id ?? 'none'),
      title: group.external ? 'External / 3rd party' : (group.discipline?.name ?? 'No discipline'),
      color: group.external ? NEUTRAL_COLOR : group.discipline?.color,
      external: !!group.external,
      // People first, placeholders ("slots") second, within each discipline. Stable
      // sort, so the existing relative order is preserved within each partition.
      rows: group.resources
        .filter(resourceVisible)
        .sort((a, b) => Number(a.kind === 'placeholder') - Number(b.kind === 'placeholder'))
        .map((resource) => {
        // This resource's data, pre-grouped above; capacity then scans only its own
        // allocations/time-off, not the whole dataset per day (was O(res×days×allocs)).
        const allAllocs = allocsByResource.get(resource.id) ?? []
        const resTimeOff = timeOffByResource.get(resource.id) ?? []
        // External / 3rd-party rows have NO capacity: no over-markers, no utilisation, no time-off
        // — an awareness band, not a bookable lane. We starve the capacity path rather than
        // special-case the (dumb) lane; their task bars still render.
        const isExternal = isExternalResource(resource)
        // A row is "dimmed" when a work filter (client/project OR the task lens) is active and
        // this resource has NO VISIBLE work on it — we still show their full real load (so you can see
        // who's free to staff), just visually de-emphasised. Uses `allocVisible` (the
        // same predicate the bars use), so a resource whose only matching allocation is a
        // HIDDEN tentative one is correctly treated as unmatched — not rendered as a
        // full-opacity, zero-bar "ghost" row that escapes the show-unmatched filter.
        const dimmed = workFilterActive && !allAllocs.some(allocVisible)
        const visibleAllocs = dimmed ? allAllocs.filter(notTentativeHidden) : allAllocs.filter(allocVisible)
        const { lanes, laneCount } = packLanes(visibleAllocs)
        const laneById = new Map(lanes.map((l) => [l.id, l.lane]))
        const bars: BarLayout[] = visibleAllocs.map((a) => {
          const meta = taskMeta.get(a.taskId)
          const project = meta?.projectId ? projectById.get(meta.projectId) : undefined
          const client = meta?.clientId ? clientById.get(meta.clientId) : undefined
          return {
            allocation: a,
            x: geom.xForDateInGeom(a.startDate),
            width: geom.widthForDates(a.startDate, a.endDate),
            top: laneTop(laneById.get(a.id) ?? 0, laneLayout),
            color: resolveBarColor(a, colorMaps),
            label: taskById.get(a.taskId)?.name ?? 'Task',
            project: project?.name,
            client: client?.name,
            external: isExternal,
          }
        })
        // Capacity reflects ALL the resource's allocations (truthful load), not the filtered view.
        // External rows carry none — flat, unmarked day cells and no time-off blocks.
        const dayStates: DayState[] = isExternal
          ? days.map(() => ({ over: false, unavailable: false }))
          : days.map((d) => {
              const cap = dayCapacity(resource, d, allAllocs, resTimeOff)
              return { over: cap.over, unavailable: cap.available === 0 }
            })
        const timeOff: TimeOffBlock[] = isExternal
          ? []
          : resTimeOff.map((t) => ({
              id: t.id,
              x: geom.xForDateInGeom(t.startDate),
              width: geom.widthForDates(t.startDate, t.endDate),
              label: TIME_OFF_TYPE_LABELS[t.type],
              note: t.note,
            }))
        // Compute the utilisation window once and derive both the % and the
        // near-term overbooked flag from it. Both ignore zero-capacity days
        // (weekends / time off) so an allocation that merely spans them doesn't
        // inflate the % past 100% or trip the overbooked flag — that's distinct
        // from the per-day over-marker, which DOES flag any zero-capacity day.
        // External rows are skipped entirely: utilisation 0, never overbooked.
        let utilization = 0
        let overSoon = false
        if (!isExternal) {
          const winCaps = capacityForWindow(resource, allAllocs, resTimeOff, utilStart, utilEnd)
          let alloc = 0
          let avail = 0
          for (const c of winCaps) {
            if (c.available === 0) continue
            alloc += c.allocated
            avail += c.available
            if (c.allocated > c.available) overSoon = true
          }
          utilization = avail === 0 ? 0 : alloc / avail
        }
        return {
          resource,
          rowHeight: rowHeightForLanes(laneCount, laneLayout),
          bars,
          dayStates,
          timeOff,
          utilization,
          overSoon,
          dimmed,
        }
      })
      // Non-matching rows are hidden by default; the "Show unallocated" toggle opts
      // the dimmed staffing view back in.
      .filter((row) => filters.showUnmatched || !row.dimmed),
    }))
    .filter((g) => g.rows.length > 0)
}
