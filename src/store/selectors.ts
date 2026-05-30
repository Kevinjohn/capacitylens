import { addDaysISO } from '../lib/dateMath'
import { emptyAppData, SCOPED_KEYS } from '../types/entities'
import type { AppData, Discipline, ID, Resource, ScopedEntity } from '../types/entities'
import type { SchedulerUI } from './useStore'

/** Narrow the full store data to a single account: every scoped array filtered to
 *  `accountId`, and `accounts` blanked (scoped views never read the tenant list). */
export function scopeData(data: AppData, accountId: ID): AppData {
  const scoped = emptyAppData()
  for (const key of SCOPED_KEYS) {
    scoped[key] = (data[key] as ScopedEntity[]).filter((e) => e.accountId === accountId) as never
  }
  return scoped
}

// Pure derived-state helpers. Components call these inside useMemo (keyed on the
// relevant slice) so Zustand selectors never return fresh objects directly —
// avoiding the useSyncExternalStore re-render trap.

export const allocationsForResource = (data: AppData, resourceId: ID) =>
  data.allocations.filter((a) => a.resourceId === resourceId)

export const timeOffForResource = (data: AppData, resourceId: ID) =>
  data.timeOff.filter((t) => t.resourceId === resourceId)

export const projectsForClient = (data: AppData, clientId: ID) =>
  data.projects.filter((p) => p.clientId === clientId)

export const phasesForProject = (data: AppData, projectId: ID) =>
  data.phases.filter((p) => p.projectId === projectId)

export const tasksForProject = (data: AppData, projectId: ID) =>
  data.tasks.filter((t) => t.projectId === projectId)

export const taskById = (data: AppData, id: ID) => data.tasks.find((t) => t.id === id)
export const projectById = (data: AppData, id: ID) => data.projects.find((p) => p.id === id)
export const clientById = (data: AppData, id: ID) => data.clients.find((c) => c.id === id)
export const resourceById = (data: AppData, id: ID) => data.resources.find((r) => r.id === id)

export interface DisciplineGroup {
  discipline: Discipline | null // null = the "no discipline" bucket
  resources: Resource[]
}

/** Canonical discipline ordering: by sortOrder, then name as a stable tiebreak.
 *  Shared by the scheduler grouping AND the Disciplines list so the two surfaces
 *  never disagree when two disciplines share a sortOrder. */
export const byDisciplineOrder = (a: Discipline, b: Discipline): number =>
  a.sortOrder - b.sortOrder || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)

/** Resources grouped by discipline (sorted), with an "ungrouped" bucket last. */
export function resourcesByDiscipline(data: AppData): DisciplineGroup[] {
  const sorted = [...data.disciplines].sort(byDisciplineOrder)
  const groups: DisciplineGroup[] = sorted.map((d) => ({
    discipline: d,
    resources: data.resources.filter((r) => r.disciplineId === d.id),
  }))
  const known = new Set(data.disciplines.map((d) => d.id))
  const ungrouped = data.resources.filter((r) => !r.disciplineId || !known.has(r.disciplineId))
  if (ungrouped.length) groups.push({ discipline: null, resources: ungrouped })
  return groups
}

export function visibleRange(ui: SchedulerUI): { start: string; end: string } {
  return { start: ui.originDate, end: addDaysISO(ui.originDate, ui.rangeDays - 1) }
}
