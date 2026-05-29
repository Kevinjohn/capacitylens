import { widthForRange, xForDate } from '../../lib/dateMath'
import { laneTop, packLanes, rowHeightForLanes } from '../../lib/lanePacking'
import { capacityForWindow, dayCapacity } from '../../lib/capacity'
import { resolveBarColor } from '../../lib/color'
import { TIME_OFF_TYPE_LABELS } from '../../lib/metadata'
import { resourcesByDiscipline } from '../../store/selectors'
import { laneLayout } from './layout'
import type { Filters } from '../../store/useStore'
import type { Allocation, AppData, ID, ISODate, Resource } from '../../types/entities'

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
  const taskMeta = new Map(
    data.tasks.map((t) => {
      const project = projectById.get(t.projectId)
      return [t.id, { projectId: t.projectId, clientId: project?.clientId }]
    }),
  )

  const allocVisible = (a: Allocation): boolean => {
    const meta = taskMeta.get(a.taskId)
    if (filters.projectId && meta?.projectId !== filters.projectId) return false
    if (filters.clientId && meta?.clientId !== filters.clientId) return false
    if (filters.hideTentative && a.status === 'tentative') return false
    return true
  }
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
        const allAllocs = data.allocations.filter((a) => a.resourceId === resource.id)
        const visibleAllocs = allAllocs.filter(allocVisible)
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
            color: resolveBarColor(a, data),
            label: taskById.get(a.taskId)?.name ?? 'Task',
            project: project?.name,
            client: client?.name,
          }
        })
        // Capacity reflects ALL allocations (truthful load), not the filtered view.
        const dayStates: DayState[] = days.map((d) => {
          const cap = dayCapacity(resource, d, data.allocations, data.timeOff)
          return { over: cap.over, unavailable: cap.available === 0 }
        })
        const timeOff: TimeOffBlock[] = data.timeOff
          .filter((t) => t.resourceId === resource.id)
          .map((t) => ({
            id: t.id,
            x: xForDate(t.startDate, origin, dayWidth),
            width: widthForRange(t.startDate, t.endDate, dayWidth),
            label: TIME_OFF_TYPE_LABELS[t.type],
            note: t.note,
          }))
        // Compute the utilisation window once and derive both the % and the
        // near-term overbooked flag from it (over-allocated on any day in window).
        const winCaps = capacityForWindow(resource, data.allocations, data.timeOff, utilStart, utilEnd)
        let alloc = 0
        let avail = 0
        for (const c of winCaps) {
          alloc += c.allocated
          avail += c.available
        }
        return {
          resource,
          rowHeight: rowHeightForLanes(laneCount, laneLayout),
          bars,
          dayStates,
          timeOff,
          utilization: avail === 0 ? 0 : alloc / avail,
          overSoon: winCaps.some((c) => c.over),
        }
      }),
    }))
    .filter((g) => g.rows.length > 0)
}
