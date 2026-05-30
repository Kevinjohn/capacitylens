import { widthForRange, xForDate } from '../../lib/dateMath'
import { laneTop, packLanes, rowHeightForLanes } from '../../lib/lanePacking'
import { capacityForWindow, dayCapacity } from '../../lib/capacity'
import { resolveBarColor } from '../../lib/color'
import { TIME_OFF_TYPE_LABELS } from '../../lib/metadata'
import { resourcesByDiscipline } from '../../store/selectors'
import { laneLayout } from './layout'
import type { Filters } from '../../store/useStore'
import type { Allocation, AppData, ID, ISODate, Resource, TimeOff } from '../../types/entities'

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
  rows: RowModel[]
}

export function buildSchedulerModel(
  data: AppData,
  origin: ISODate,
  dayWidth: number,
  days: ISODate[],
  // The utilisation window is deliberately decoupled from `days`: per-day states
  // span the whole visible timeline, but the headline % is a fixed near-term
  // window (see UTILIZATION_WINDOW_DAYS) so overbooking isn't averaged away.
  utilStart: ISODate,
  utilEnd: ISODate,
  filters: Filters,
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
      const project = projectById.get(t.projectId)
      return [t.id, { projectId: t.projectId, clientId: project?.clientId }]
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
  const allocVisible = (a: Allocation): boolean => {
    if (!matchesProjectClient(a)) return false
    if (filters.hideTentative && a.status === 'tentative') return false
    return true
  }
  const notTentativeHidden = (a: Allocation): boolean => !(filters.hideTentative && a.status === 'tentative')
  const resourceVisible = (r: Resource): boolean => {
    if (filters.disciplineId && r.disciplineId !== filters.disciplineId) return false
    if (search && !`${r.name ?? ''} ${r.role}`.toLowerCase().includes(search)) return false
    return true
  }

  return resourcesByDiscipline(data)
    .map((group) => ({
      key: group.discipline?.id ?? 'none',
      title: group.discipline?.name ?? 'No discipline',
      color: group.discipline?.color,
      rows: group.resources.filter(resourceVisible).map((resource) => {
        // This resource's data, pre-grouped above; capacity then scans only its own
        // allocations/time-off, not the whole dataset per day (was O(res×days×allocs)).
        const allAllocs = allocsByResource.get(resource.id) ?? []
        const resTimeOff = timeOffByResource.get(resource.id) ?? []
        // A row is "dimmed" when a project/client filter is active and this resource
        // has NO work on it — we still show their full real load (so you can see who's
        // free to staff), just visually de-emphasised. Matched rows focus on the
        // matching bars as before.
        const dimmed = projectClientActive && !allAllocs.some(matchesProjectClient)
        const visibleAllocs = dimmed ? allAllocs.filter(notTentativeHidden) : allAllocs.filter(allocVisible)
        const { lanes, laneCount } = packLanes(visibleAllocs)
        const laneById = new Map(lanes.map((l) => [l.id, l.lane]))
        const bars: BarLayout[] = visibleAllocs.map((a) => {
          const meta = taskMeta.get(a.taskId)
          const project = meta ? projectById.get(meta.projectId) : undefined
          const client = meta?.clientId ? clientById.get(meta.clientId) : undefined
          return {
            allocation: a,
            x: xForDate(a.startDate, origin, dayWidth),
            width: widthForRange(a.startDate, a.endDate, dayWidth),
            top: laneTop(laneById.get(a.id) ?? 0, laneLayout),
            color: resolveBarColor(a, colorMaps),
            label: taskById.get(a.taskId)?.name ?? 'Task',
            project: project?.name,
            client: client?.name,
          }
        })
        // Capacity reflects ALL the resource's allocations (truthful load), not the filtered view.
        const dayStates: DayState[] = days.map((d) => {
          const cap = dayCapacity(resource, d, allAllocs, resTimeOff)
          return { over: cap.over, unavailable: cap.available === 0 }
        })
        const timeOff: TimeOffBlock[] = resTimeOff.map((t) => ({
            id: t.id,
            x: xForDate(t.startDate, origin, dayWidth),
            width: widthForRange(t.startDate, t.endDate, dayWidth),
            label: TIME_OFF_TYPE_LABELS[t.type],
            note: t.note,
          }))
        // Compute the utilisation window once and derive both the % and the
        // near-term overbooked flag from it. Both ignore zero-capacity days
        // (weekends / time off) so an allocation that merely spans them doesn't
        // inflate the % past 100% or trip the overbooked flag — that's distinct
        // from the per-day over-marker, which DOES flag any zero-capacity day.
        const winCaps = capacityForWindow(resource, allAllocs, resTimeOff, utilStart, utilEnd)
        let alloc = 0
        let avail = 0
        let overSoon = false
        for (const c of winCaps) {
          if (c.available === 0) continue
          alloc += c.allocated
          avail += c.available
          if (c.allocated > c.available) overSoon = true
        }
        return {
          resource,
          rowHeight: rowHeightForLanes(laneCount, laneLayout),
          bars,
          dayStates,
          timeOff,
          utilization: avail === 0 ? 0 : alloc / avail,
          overSoon,
          dimmed,
        }
      })
      // The "show unallocated" toggle (default on) hides the dimmed non-matching rows.
      .filter((row) => filters.showUnmatched || !row.dimmed),
    }))
    .filter((g) => g.rows.length > 0)
}
