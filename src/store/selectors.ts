import { addDaysISO } from '@capacitylens/shared/lib/dateMath'
import { byAccount } from '@capacitylens/shared/domain/tenancy'
import { emptyAppData, isCapacityTracked, isExternalResource, scopedTables, SCOPED_KEYS } from '@capacitylens/shared/types/entities'
import type { AppData, Discipline, ID, Resource, SchedulingMode } from '@capacitylens/shared/types/entities'
import type { SchedulerUI } from './useStore'

export interface CalendarConfig {
  timeZone: string
  weekStartsOn: 0 | 1
}

/** The active company's scheduling input mode. Absent on the account reads as the
 *  original 'hourly' behaviour. Single source so the modal and the bar can't drift. */
export const schedulingModeFor = (data: AppData, activeAccountId: ID | null): SchedulingMode =>
  data.accounts.find((a) => a.id === activeAccountId)?.schedulingMode ?? 'hourly'

/** Whether the active company uses disciplines. Absent on the account reads as true
 *  (the original behaviour). Single source so every discipline surface (nav, resource
 *  form, schedule grouping + filter, lists, command palette) gates on the same value. */
export const disciplinesEnabledFor = (data: AppData, activeAccountId: ID | null): boolean =>
  data.accounts.find((a) => a.id === activeAccountId)?.disciplinesEnabled ?? true

/** Whether the active company shows placeholder ("slot") rows. Absent on the account reads as
 *  FALSE (hidden) — the documented default-off behaviour. NOTE the `?? false` (contrast
 *  disciplinesEnabledFor's `?? true`): a new/seed/imported account with no field stays hidden.
 *  Single source so every placeholder surface (schedule, assignee picker, Resources + Time off
 *  lists, command palette) gates on the same per-account value. */
export const placeholdersEnabledFor = (data: AppData, activeAccountId: ID | null): boolean =>
  data.accounts.find((a) => a.id === activeAccountId)?.placeholdersEnabled ?? false

/** Whether the active company shows external / 3rd-party rows. Absent on the account reads as
 *  FALSE (hidden) — the documented default-off behaviour (`?? false`, like placeholdersEnabledFor,
 *  NOT disciplinesEnabledFor's `?? true`). Single source so every external surface gates on the
 *  same per-account value. */
export const externalEnabledFor = (data: AppData, activeAccountId: ID | null): boolean =>
  data.accounts.find((a) => a.id === activeAccountId)?.externalEnabled ?? false

/** The active account's calendar config — timezone and week-start day.
 *  Absent fields fall back to the defaults (Etc/GMT, Monday). */
export const calendarFor = (data: AppData, activeAccountId: ID | null): CalendarConfig => {
  const account = data.accounts.find((a) => a.id === activeAccountId)
  return {
    timeZone: account?.timezone ?? 'Etc/GMT',
    weekStartsOn: account?.weekStartsOn ?? 1,
  }
}

/** Narrow the full store data to a single account: every scoped array filtered to
 *  `accountId`, and `accounts` blanked (scoped views never read the tenant list).
 *
 *  This is THE read-side tenancy boundary, and its correctness rests on a NON-LOCAL fact:
 *  `SCOPED_KEYS` must be EXHAUSTIVE over AppData's scoped tables. `scoped` starts as emptyAppData()
 *  and only the SCOPED_KEYS are copied across — so a scoped table that AppData gains but SCOPED_KEYS
 *  omits would render EMPTY in every scoped view (the rows silently vanish). The exhaustiveness gate
 *  (see CLAUDE.md / DECISIONS.md) keeps SCOPED_KEYS complete; never add a scoped table without it. */
export function scopeData(data: AppData, accountId: ID): AppData {
  const scoped = emptyAppData()
  const src = scopedTables(data)
  const dst = scopedTables(scoped)
  for (const key of SCOPED_KEYS) {
    dst[key] = src[key].filter(byAccount(accountId))
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

export const activitiesForProject = (data: AppData, projectId: ID) =>
  data.activities.filter((t) => t.projectId === projectId)

// Find-by-id helpers. Each returns `T | undefined` — `find` MISSES for a stale or cross-account
// id, so callers must narrow (optional-chain / guard) before dereferencing, never assume the id
// resolves. (The fix for a possibly-undefined result belongs at the CONSUMER, not as a throw here.)
export const activityById = (data: AppData, id: ID) => data.activities.find((t) => t.id === id)
export const projectById = (data: AppData, id: ID) => data.projects.find((p) => p.id === id)
export const clientById = (data: AppData, id: ID) => data.clients.find((c) => c.id === id)
export const resourceById = (data: AppData, id: ID) => data.resources.find((r) => r.id === id)

export interface DisciplineGroup {
  discipline: Discipline | null // null = the "no discipline" bucket
  resources: Resource[]
  /** True for the synthetic trailing group of external / 3rd-party resources — rendered as a
   *  neutral band at the very bottom of the schedule (externals have no discipline to group by). */
  external?: boolean
}

/** Canonical discipline ordering: by sortOrder, then name as a stable tiebreak.
 *  Shared by the scheduler grouping AND the Disciplines list so the two surfaces
 *  never disagree when two disciplines share a sortOrder. */
export const byDisciplineOrder = (a: Discipline, b: Discipline): number =>
  a.sortOrder - b.sortOrder || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)

/** The trailing external / 3rd-party band (neutral, always last), or null when there are none. The
 *  ONE source for the partition so the disciplines-on (here) and disciplines-off (schedulerModel)
 *  schedules can't disagree on where externals split off or how the band is shaped. */
export function externalBand(resources: Resource[]): DisciplineGroup | null {
  const external = resources.filter(isExternalResource)
  return external.length ? { discipline: null, resources: external, external: true } : null
}

/** Resources grouped by discipline (sorted), with an "ungrouped" bucket, then a trailing EXTERNAL
 *  band last. External / 3rd-party resources are partitioned out of the discipline buckets entirely
 *  so they always render as their own neutral band at the very bottom of the schedule. */
export function resourcesByDiscipline(data: AppData): DisciplineGroup[] {
  const ours = data.resources.filter(isCapacityTracked) // externals get their own trailing band
  const sorted = [...data.disciplines].sort(byDisciplineOrder)
  const groups: DisciplineGroup[] = sorted.map((d) => ({
    discipline: d,
    resources: ours.filter((r) => r.disciplineId === d.id),
  }))
  const known = new Set(data.disciplines.map((d) => d.id))
  const ungrouped = ours.filter((r) => !r.disciplineId || !known.has(r.disciplineId))
  if (ungrouped.length) groups.push({ discipline: null, resources: ungrouped })
  const band = externalBand(data.resources)
  if (band) groups.push(band)
  return groups
}

export function visibleRange(ui: SchedulerUI): { start: string; end: string } {
  return { start: ui.originDate, end: addDaysISO(ui.originDate, ui.rangeDays - 1) }
}
