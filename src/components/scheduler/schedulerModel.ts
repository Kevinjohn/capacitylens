import { laneTop, packLanes, rowHeightForLanes } from '../../lib/lanePacking'
import { capacityForWindow, dayCapacity, utilization as utilizationOf } from '../../lib/capacity'
import { resolveBarColor } from '@capacitylens/shared/lib/color'
import { timeOffTypeLabels, resourceDisplayName } from '../../lib/metadata'
import { externalBand, resourcesByDiscipline, type DisciplineGroup } from '../../store/selectors'
import { isCapacityTracked, isExternalResource } from '@capacitylens/shared/types/entities'
import { internalClientFor } from '@capacitylens/shared/data/internalClient'
import { NEUTRAL_COLOR } from '../../lib/palette'
import { laneLayout } from './layout'
import type { ColumnGeometry } from './columnGeometry'
import type { Filters } from '../../store/useStore'
import type { Allocation, AppData, ID, ISODate, Resource, TimeOff } from '@capacitylens/shared/types/entities'

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
  utilization: number // working-day ratio over the VISIBLE window [visStart, visEnd]
  overSoon: boolean // over-allocated on >=1 working day inside the FIXED forward window [overStart, overEnd]
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
  // TWO separate windows, deliberately distinct (CLAUDE.md / DECISIONS.md):
  //
  // - [visStart, visEnd] drives the DISPLAYED utilisation % (per-person `utilization`, and so the
  //   per-discipline avg + overall figures that average it). It tracks the currently VISIBLE span
  //   (the zoom range anchored at the scroll left-edge), so "63% utilisation" answers "over the
  //   weeks I'm looking at". SchedulerGrid passes this day-quantized (recomputed only when the
  //   left-edge DAY or the zoom changes, never per scroll pixel).
  // - [overStart, overEnd] drives the `overSoon` red flag ONLY: a FIXED forward window from today
  //   (UTILIZATION_WINDOW_DAYS), independent of zoom/pan — the second, zoom-independent "over soon"
  //   warning that must stay separate from the zoomable %. Don't widen it to the visible window.
  //
  // The per-day over-marker (dayStates.over) is a THIRD, distinct signal — it flags any day where
  // allocated > available (the over / red-background signal) across the whole `days` timeline. Its
  // `allocated` is weekend-aware (a bar merely spanning Sat/Sun does no weekend work), so the only
  // zero-capacity days it catches are a TIME-OFF day a working allocation covers and a weekend an
  // allocation opts into via `ignoreWeekends`.
  visStart: ISODate,
  visEnd: ISODate,
  overStart: ISODate,
  overEnd: ISODate,
  filters: Filters,
  // When false (account.disciplinesEnabled === false) the schedule renders FLAT: one
  // synthetic group holding every resource (no discipline bands), and the discipline
  // filter is ignored. SchedulerGrid skips the group-header row for the flat group.
  disciplinesEnabled: boolean,
  // Per-account view pref (default OFF). When false, placeholder ("slot") resources are dropped
  // by `resourceVisible` below — this ONE filter removes the lane, its bars/day-states, AND its
  // contribution to per-discipline + overall utilisation (both derive from this model). It is a
  // pure VIEW pref: the placeholder resources and their allocations stay in the data untouched and
  // reappear when re-enabled. See selectors.ts / DECISIONS.md.
  placeholdersEnabled: boolean,
  // Per-account view pref (default OFF), the EXACT analog of `placeholdersEnabled` for external /
  // 3rd-party resources. When false, externals are dropped by `resourceVisible` below — the same
  // single chokepoint. Crucially that also empties the trailing external band, which the final
  // `.filter((g) => g.rows.length > 0)` then drops, so NO empty "External / 3rd party" header
  // renders when externals are hidden. A pure VIEW pref: external data is untouched and reappears
  // when re-enabled. See selectors.ts / DECISIONS.md.
  externalEnabled: boolean,
): GroupModel[] {
  const search = filters.search.trim().toLowerCase()
  const projectById = new Map(data.projects.map((p) => [p.id, p]))
  const clientById = new Map(data.clients.map((c) => [c.id, c]))
  const activityById = new Map(data.activities.map((act) => [act.id, act]))
  const resourceById = new Map(data.resources.map((r) => [r.id, r]))
  // Reused for every bar's colour (project → client → resource → grey fallback).
  const colorMaps = { activities: activityById, projects: projectById, clients: clientById, resources: resourceById }
  // The built-in Internal client for the data being rendered (one per account; the data here is
  // already scoped to the active account, so every client shares that accountId). A project-less
  // activity DERIVES this as its client for display + filtering — without ever writing it onto the
  // activity (no activity.clientId field). If somehow absent (a partial/legacy blob), project-less
  // activities fall back to no client. Uses the SHARED `internalClientFor` predicate (the single
  // source of truth for "the account's builtin Internal") rather than an inline flag scan, so the
  // definition can't drift from migrate/import/server. The accountId comes from the scoped data
  // itself (all rows here belong to the active account); absent any client, there's no builtin.
  const scopedAccountId = data.clients[0]?.accountId
  const internalClient = scopedAccountId ? internalClientFor(data.clients, scopedAccountId) : undefined
  const activityMeta = new Map(
    data.activities.map((act) => {
      // A project activity's client is its project's client. A project-less internal/repeatable
      // activity has NO project, so its client is DERIVED as the account's built-in Internal client
      // (purely for the view-model — never persisted). `kind` feeds the activity lens
      // ('Internal — All' / 'Repeatable — All') without a second activity lookup.
      const project = act.projectId ? projectById.get(act.projectId) : undefined
      const clientId = project ? project.clientId : internalClient?.id
      return [act.id, { projectId: act.projectId, clientId, kind: act.kind }]
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
    const meta = activityMeta.get(a.activityId)
    if (filters.projectId && meta?.projectId !== filters.projectId) return false
    if (filters.clientId && meta?.clientId !== filters.clientId) return false
    return true
  }
  // The activity lens (standalone — mutually exclusive with project/client via setFilters): a
  // specific internal/repeatable activity, or a whole kind ('Internal — All' / 'Repeatable — All').
  const activityFilterActive = !!(filters.activityId || filters.activityKind)
  const matchesActivity = (a: Allocation): boolean => {
    if (filters.activityId) return a.activityId === filters.activityId
    if (filters.activityKind) return activityMeta.get(a.activityId)?.kind === filters.activityKind
    return true
  }
  // Any "what work" filter is active — drives the dimmed / show-unmatched staffing view, which
  // is identical whether the active lens is client/project or activity.
  const workFilterActive = projectClientActive || activityFilterActive
  const notTentativeHidden = (a: Allocation): boolean => !(filters.hideTentative && a.status === 'tentative')
  const allocVisible = (a: Allocation): boolean =>
    matchesProjectClient(a) && matchesActivity(a) && notTentativeHidden(a)
  const resourceVisible = (r: Resource): boolean => {
    // Placeholders are gated behind a per-account pref (default OFF). Dropping the row here is the
    // single chokepoint that also removes its bars, day-states, and utilisation contribution — the
    // resource itself is untouched in the data, so this is a hide, not a delete. A placeholder's
    // allocations simply go unreferenced (the model is built resource-first via allocsByResource).
    if (!placeholdersEnabled && r.kind === 'placeholder') return false
    // External / 3rd parties are gated behind their own per-account pref (default OFF), exactly
    // like placeholders. Dropping the row here empties the external band; the trailing
    // `rows.length > 0` filter then removes the band group so no empty header is drawn (risk #2).
    if (!externalEnabled && isExternalResource(r)) return false
    if (disciplinesEnabled && filters.disciplineId && r.disciplineId !== filters.disciplineId) return false
    // Search the DISPLAY name too, so a placeholder (shown as "Placeholder") is findable by what the
    // user sees — matching the command palette — as well as by its underlying role/name.
    if (search && !`${resourceDisplayName(r)} ${r.name ?? ''} ${r.role}`.toLowerCase().includes(search)) return false
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
        // special-case the (dumb) lane; their activity bars still render.
        const isExternal = isExternalResource(resource)
        // A row is "dimmed" when a work filter (client/project OR the activity lens) is active and
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
          const meta = activityMeta.get(a.activityId)
          const project = meta?.projectId ? projectById.get(meta.projectId) : undefined
          const client = meta?.clientId ? clientById.get(meta.clientId) : undefined
          return {
            allocation: a,
            x: geom.xForDateInGeom(a.startDate),
            width: geom.widthForDates(a.startDate, a.endDate),
            top: laneTop(laneById.get(a.id) ?? 0, laneLayout),
            color: resolveBarColor(a, colorMaps),
            label: activityById.get(a.activityId)?.name ?? 'Activity',
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
              label: timeOffTypeLabels()[t.type],
              note: t.note,
            }))
        // The DISPLAYED utilisation % runs over the VISIBLE window [visStart, visEnd]; the
        // `overSoon` red flag runs over the FIXED forward window [overStart, overEnd] — two
        // deliberately separate signals (see the param doc above). Both ignore zero-capacity days
        // (weekends / time off) so an allocation that merely spans them doesn't inflate the % past
        // 100% or trip the flag — like the per-day over-marker (dayStates.over), whose weekend-aware
        // `allocated` likewise leaves a merely-spanned weekend un-flagged (it still flags a time-off
        // day a working allocation covers, and an `ignoreWeekends` weekend). External rows are skipped
        // entirely: utilisation 0, never overbooked. `utilization` reuses the pure capacity helper.
        const utilization = isExternal ? 0 : utilizationOf(resource, allAllocs, resTimeOff, visStart, visEnd)
        let overSoon = false
        if (!isExternal) {
          for (const c of capacityForWindow(resource, allAllocs, resTimeOff, overStart, overEnd)) {
            // Working day, genuinely over (skip zero-capacity weekend/time-off days).
            if (c.available > 0 && c.allocated > c.available) {
              overSoon = true
              break
            }
          }
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
