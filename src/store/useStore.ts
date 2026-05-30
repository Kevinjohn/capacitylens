import { create } from 'zustand'
import { newId } from '../lib/id'
import { addDaysISO, todayISO } from '../lib/dateMath'
import { DEFAULT_ORIGIN_OFFSET_DAYS, DEFAULT_RANGE_DAYS, DEFAULT_ZOOM, type WeeksZoom } from '../lib/schedulerConfig'
import {
  deleteClientCascade,
  deleteDisciplineCascade,
  deletePhaseCascade,
  deleteProjectCascade,
  deleteResourceCascade,
  deleteTaskCascade,
  validateAllocationAssignment,
  validateDateRange,
} from '../lib/integrity'
import { emptyAppData, SCOPED_KEYS } from '../types/entities'
import type {
  Account,
  Allocation,
  AppData,
  Client,
  Discipline,
  Entity,
  ID,
  ISODate,
  Phase,
  Project,
  Resource,
  ScopedEntity,
  Task,
  TimeOff,
} from '../types/entities'

// A Draft drops the server-owned fields (id/timestamps) AND `accountId` — the
// store stamps the active account, so callers never supply it.
export type Draft<T extends Entity> = Omit<T, 'id' | 'accountId' | 'createdAt' | 'updatedAt'>
export type Patch<T extends Entity> = Partial<Draft<T>>

// Re-exported for convenience.
export type { WeeksZoom }

export interface Filters {
  disciplineId: ID | null
  clientId: ID | null
  projectId: ID | null
  search: string
  hideTentative: boolean
}

export const emptyFilters = (): Filters => ({
  disciplineId: null,
  clientId: null,
  projectId: null,
  search: '',
  hideTentative: false,
})

export function hasActiveFilters(f: Filters): boolean {
  return !!f.disciplineId || !!f.clientId || !!f.projectId || f.search.trim() !== '' || f.hideTentative
}

/** What a draw-on-a-lane gesture creates. */
export type DrawMode = 'work' | 'timeoff'

export interface SchedulerUI {
  zoom: WeeksZoom // number of weeks visible; day-column width is derived from it
  originDate: ISODate
  rangeDays: number
  focusDate: ISODate // the date the grid scrolls to when recenterToken bumps
  drawMode: DrawMode // draw-to-create makes an allocation ('work') or time off
  selectedAllocationId: ID | null
  filters: Filters
  collapsedGroups: string[] // discipline group keys that are collapsed
  recenterToken: number // bumped to ask the grid to scroll focusDate back into view
}

export interface StoreState {
  data: AppData
  ui: SchedulerUI
  hydrated: boolean
  /** The tenant currently in view. Null = no account chosen (show the picker). Never persisted. */
  activeAccountId: ID | null
  past: AppData[]
  future: AppData[]
  persistError: boolean
  notice: string | null // transient user message (e.g. a rejected drag); auto-dismissed by the UI

  addAccount: (input: Draft<Account>) => Account
  updateAccount: (id: ID, patch: Patch<Account>) => void
  deleteAccount: (id: ID) => void
  setActiveAccount: (id: ID | null) => void

  replaceAll: (data: AppData) => void
  /** Replace the whole dataset (e.g. JSON import) but keep it undoable via ⌘Z. */
  importData: (data: AppData) => void
  setHydrated: (v: boolean) => void
  setPersistError: (v: boolean) => void
  setNotice: (message: string | null) => void
  undo: () => void
  redo: () => void

  addDiscipline: (input: Draft<Discipline>) => Discipline
  updateDiscipline: (id: ID, patch: Patch<Discipline>) => void
  deleteDiscipline: (id: ID) => void

  addResource: (input: Draft<Resource>) => Resource
  updateResource: (id: ID, patch: Patch<Resource>) => void
  deleteResource: (id: ID) => void

  addClient: (input: Draft<Client>) => Client
  updateClient: (id: ID, patch: Patch<Client>) => void
  deleteClient: (id: ID) => void

  addProject: (input: Draft<Project>) => Project
  updateProject: (id: ID, patch: Patch<Project>) => void
  deleteProject: (id: ID) => void

  addPhase: (input: Draft<Phase>) => Phase
  updatePhase: (id: ID, patch: Patch<Phase>) => void
  deletePhase: (id: ID) => void

  addTask: (input: Draft<Task>) => Task
  updateTask: (id: ID, patch: Patch<Task>) => void
  deleteTask: (id: ID) => void

  addAllocation: (input: Draft<Allocation>) => Allocation
  updateAllocation: (id: ID, patch: Patch<Allocation>) => void
  deleteAllocation: (id: ID) => void

  addTimeOff: (input: Draft<TimeOff>) => TimeOff
  updateTimeOff: (id: ID, patch: Patch<TimeOff>) => void
  deleteTimeOff: (id: ID) => void

  setZoom: (zoom: WeeksZoom) => void
  setOriginDate: (date: ISODate) => void
  panDays: (delta: number) => void
  goToToday: () => void
  goToDate: (date: ISODate) => void
  setDrawMode: (mode: DrawMode) => void
  selectAllocation: (id: ID | null) => void
  setFilters: (patch: Partial<Filters>) => void
  clearFilters: () => void
  toggleGroup: (key: string) => void
}

const stamp = () => {
  const now = new Date().toISOString()
  return { createdAt: now, updatedAt: now }
}
const touch = () => new Date().toISOString()

const defaultUI = (): SchedulerUI => ({
  zoom: DEFAULT_ZOOM,
  originDate: addDaysISO(todayISO(), DEFAULT_ORIGIN_OFFSET_DAYS),
  rangeDays: DEFAULT_RANGE_DAYS,
  focusDate: todayISO(),
  drawMode: 'work',
  selectedAllocationId: null,
  filters: emptyFilters(),
  collapsedGroups: [],
  recenterToken: 0,
})

const HISTORY_LIMIT = 50

export const useStore = create<StoreState>()((set, get) => {
  // Every data mutation goes through mutate(): it snapshots the previous data
  // onto the undo stack and clears the redo stack.
  const mutate = (producer: (d: AppData) => AppData) =>
    set((s) => ({ data: producer(s.data), past: [...s.past, s.data].slice(-HISTORY_LIMIT), future: [] }))

  const updateById = <T extends Entity>(list: T[], id: ID, patch: Partial<Omit<T, keyof Entity>>): T[] =>
    list.map((x) => (x.id === id ? { ...x, ...patch, updatedAt: touch() } : x))

  // Every scoped add* stamps the active account. With no account chosen there's
  // nowhere to file the entity, so we fail loudly rather than create an orphan.
  const requireAccount = (): ID => {
    const id = get().activeAccountId
    if (!id) throw new Error('No active account — cannot mutate scoped data.')
    return id
  }

  // The store is the integrity boundary for allocations: an allocation must
  // reference a real resource + task, and a placeholder may only take tasks from
  // its bound project. Enforced on both add and update.
  const assertAllocation = (d: AppData, resourceId: ID, taskId: ID) => {
    const resource = d.resources.find((r) => r.id === resourceId)
    const task = d.tasks.find((t) => t.id === taskId)
    if (!resource || !task) throw new Error('Allocation must reference an existing resource and task.')
    const v = validateAllocationAssignment(resource, task.projectId)
    if (!v.ok) throw new Error(v.errors[0])
  }

  // No allocation or time-off may persist an empty or reversed date range — that
  // would render as a NaN / negative-width bar on the timeline.
  const assertDateRange = (startDate?: ISODate, endDate?: ISODate) => {
    const v = validateDateRange(startDate, endDate)
    if (!v.ok) throw new Error(v.errors[0])
  }

  // Time off references a resource exactly as an allocation does; enforce it here
  // (the store is the integrity boundary) so a dangling reference can't be created.
  const assertResourceExists = (d: AppData, resourceId: ID) => {
    if (!d.resources.some((r) => r.id === resourceId)) {
      throw new Error('Time off must reference an existing resource.')
    }
  }

  return {
    data: emptyAppData(),
    ui: defaultUI(),
    hydrated: false,
    activeAccountId: null,
    past: [],
    future: [],
    persistError: false,
    notice: null,

    addAccount: (input) => {
      const e: Account = { ...input, id: newId(), ...stamp() }
      mutate((d) => ({ ...d, accounts: [...d.accounts, e] }))
      return e
    },
    updateAccount: (id, patch) => mutate((d) => ({ ...d, accounts: updateById(d.accounts, id, patch) })),
    // Cascade-drop every scoped entity belonging to this account; if it was the
    // active one, fall back to the picker.
    deleteAccount: (id) => {
      mutate((d) => {
        const next: AppData = { ...d, accounts: d.accounts.filter((a) => a.id !== id) }
        for (const key of SCOPED_KEYS) {
          next[key] = (d[key] as ScopedEntity[]).filter((e) => e.accountId !== id) as never
        }
        return next
      })
      if (get().activeAccountId === id) get().setActiveAccount(null)
    },
    // Switching tenant resets per-account view state and history — undo must never
    // cross an account boundary, and the previous account's filters/selection don't apply.
    setActiveAccount: (id) =>
      set((s) => ({
        activeAccountId: id,
        past: [],
        future: [],
        ui: { ...s.ui, filters: emptyFilters(), collapsedGroups: [], selectedAllocationId: null },
      })),

    replaceAll: (data) => set({ data, past: [], future: [] }),
    // Replace only the active account's slice; other accounts and the account
    // list itself are untouched. Undoable via ⌘Z.
    //
    // Imported entities keep their relationships but are given FRESH ids. An
    // exported file carries the source account's ids; re-importing it into a
    // different account would otherwise collide — the store matches entities by
    // id GLOBALLY (updateById / cascade scan all accounts), so a shared id would
    // let an edit in one account silently rewrite another's row.
    importData: (incoming) =>
      mutate((d) => {
        const accountId = requireAccount()
        const idMap = new Map<ID, ID>()
        for (const key of SCOPED_KEYS) {
          for (const e of incoming[key] as ScopedEntity[]) idMap.set(e.id, newId())
        }
        // Foreign-key fields across the scoped entities; remap only those that
        // point at another imported entity (a dangling ref is left as-is).
        const FK_FIELDS = ['disciplineId', 'projectId', 'clientId', 'phaseId', 'resourceId', 'taskId'] as const
        const remap = (ref: unknown): unknown =>
          typeof ref === 'string' && idMap.has(ref) ? idMap.get(ref) : ref

        // Remap every incoming scoped entity into the active account.
        const brought: Record<string, ScopedEntity[]> = {}
        for (const key of SCOPED_KEYS) {
          brought[key] = (incoming[key] as ScopedEntity[]).map((e) => {
            const copy: Record<string, unknown> = { ...e, id: idMap.get(e.id)!, accountId }
            for (const f of FK_FIELDS) {
              if (copy[f] !== undefined) copy[f] = remap(copy[f])
            }
            return copy as unknown as ScopedEntity
          })
        }

        // The store is the integrity boundary on EVERY write — import is no
        // exception. A hand-edited / corrupt file must not slip past the rules
        // addAllocation/addTimeOff enforce, so drop imported allocations and
        // time-off with an empty/reversed range, a dangling resource/task, or a
        // placeholder/project-rule violation (which would otherwise render as
        // NaN/negative bars or orphan rows).
        const importedResources = new Map((brought.resources as Resource[]).map((r) => [r.id, r]))
        const importedTasks = new Map((brought.tasks as Task[]).map((t) => [t.id, t]))
        brought.allocations = (brought.allocations as Allocation[]).filter((a) => {
          if (!validateDateRange(a.startDate, a.endDate).ok) return false
          const resource = importedResources.get(a.resourceId)
          const task = importedTasks.get(a.taskId)
          if (!resource || !task) return false
          return validateAllocationAssignment(resource, task.projectId).ok
        })
        brought.timeOff = (brought.timeOff as TimeOff[]).filter(
          (t) => importedResources.has(t.resourceId) && validateDateRange(t.startDate, t.endDate).ok,
        )

        const next: AppData = { ...d }
        for (const key of SCOPED_KEYS) {
          const kept = (d[key] as ScopedEntity[]).filter((e) => e.accountId !== accountId)
          next[key] = [...kept, ...brought[key]] as never
        }
        return next
      }),
    setHydrated: (v) => set({ hydrated: v }),
    setPersistError: (v) => set({ persistError: v }),
    setNotice: (message) => set({ notice: message }),

    undo: () =>
      set((s) => {
        if (s.past.length === 0) return {}
        const previous = s.past[s.past.length - 1]
        return { data: previous, past: s.past.slice(0, -1), future: [s.data, ...s.future].slice(0, HISTORY_LIMIT) }
      }),
    redo: () =>
      set((s) => {
        if (s.future.length === 0) return {}
        const next = s.future[0]
        return { data: next, future: s.future.slice(1), past: [...s.past, s.data].slice(-HISTORY_LIMIT) }
      }),

    addDiscipline: (input) => {
      const e: Discipline = { ...input, id: newId(), accountId: requireAccount(), ...stamp() }
      mutate((d) => ({ ...d, disciplines: [...d.disciplines, e] }))
      return e
    },
    updateDiscipline: (id, patch) => mutate((d) => ({ ...d, disciplines: updateById(d.disciplines, id, patch) })),
    deleteDiscipline: (id) => mutate((d) => deleteDisciplineCascade(d, id)),

    addResource: (input) => {
      const e: Resource = { ...input, id: newId(), accountId: requireAccount(), ...stamp() }
      mutate((d) => ({ ...d, resources: [...d.resources, e] }))
      return e
    },
    updateResource: (id, patch) => mutate((d) => ({ ...d, resources: updateById(d.resources, id, patch) })),
    deleteResource: (id) => mutate((d) => deleteResourceCascade(d, id)),

    addClient: (input) => {
      const e: Client = { ...input, id: newId(), accountId: requireAccount(), ...stamp() }
      mutate((d) => ({ ...d, clients: [...d.clients, e] }))
      return e
    },
    updateClient: (id, patch) => mutate((d) => ({ ...d, clients: updateById(d.clients, id, patch) })),
    deleteClient: (id) => mutate((d) => deleteClientCascade(d, id)),

    addProject: (input) => {
      const e: Project = { ...input, id: newId(), accountId: requireAccount(), ...stamp() }
      mutate((d) => ({ ...d, projects: [...d.projects, e] }))
      return e
    },
    updateProject: (id, patch) => mutate((d) => ({ ...d, projects: updateById(d.projects, id, patch) })),
    deleteProject: (id) => mutate((d) => deleteProjectCascade(d, id)),

    addPhase: (input) => {
      const e: Phase = { ...input, id: newId(), accountId: requireAccount(), ...stamp() }
      mutate((d) => ({ ...d, phases: [...d.phases, e] }))
      return e
    },
    updatePhase: (id, patch) => mutate((d) => ({ ...d, phases: updateById(d.phases, id, patch) })),
    deletePhase: (id) => mutate((d) => deletePhaseCascade(d, id)),

    addTask: (input) => {
      const e: Task = { ...input, id: newId(), accountId: requireAccount(), ...stamp() }
      mutate((d) => ({ ...d, tasks: [...d.tasks, e] }))
      return e
    },
    updateTask: (id, patch) => mutate((d) => ({ ...d, tasks: updateById(d.tasks, id, patch) })),
    deleteTask: (id) => mutate((d) => deleteTaskCascade(d, id)),

    addAllocation: (input) => {
      assertAllocation(get().data, input.resourceId, input.taskId)
      assertDateRange(input.startDate, input.endDate)
      const e: Allocation = { ...input, id: newId(), accountId: requireAccount(), ...stamp() }
      mutate((d) => ({ ...d, allocations: [...d.allocations, e] }))
      return e
    },
    updateAllocation: (id, patch) => {
      const existing = get().data.allocations.find((a) => a.id === id)
      if (existing) {
        if (patch.resourceId !== undefined || patch.taskId !== undefined) {
          assertAllocation(get().data, patch.resourceId ?? existing.resourceId, patch.taskId ?? existing.taskId)
        }
        // Validate the EFFECTIVE range (merged with the existing row), so a
        // note/status/reassign-only patch isn't rejected for omitting dates.
        assertDateRange(patch.startDate ?? existing.startDate, patch.endDate ?? existing.endDate)
      }
      mutate((d) => ({ ...d, allocations: updateById(d.allocations, id, patch) }))
    },
    deleteAllocation: (id) => mutate((d) => ({ ...d, allocations: d.allocations.filter((a) => a.id !== id) })),

    addTimeOff: (input) => {
      assertResourceExists(get().data, input.resourceId)
      assertDateRange(input.startDate, input.endDate)
      const e: TimeOff = { ...input, id: newId(), accountId: requireAccount(), ...stamp() }
      mutate((d) => ({ ...d, timeOff: [...d.timeOff, e] }))
      return e
    },
    updateTimeOff: (id, patch) => {
      const existing = get().data.timeOff.find((t) => t.id === id)
      if (existing) {
        if (patch.resourceId !== undefined) assertResourceExists(get().data, patch.resourceId)
        assertDateRange(patch.startDate ?? existing.startDate, patch.endDate ?? existing.endDate)
      }
      mutate((d) => ({ ...d, timeOff: updateById(d.timeOff, id, patch) }))
    },
    deleteTimeOff: (id) => mutate((d) => ({ ...d, timeOff: d.timeOff.filter((t) => t.id !== id) })),

    setZoom: (zoom) => set((s) => ({ ui: { ...s.ui, zoom } })),
    setOriginDate: (date) => set((s) => ({ ui: { ...s.ui, originDate: date } })),
    panDays: (delta) => set((s) => ({ ui: { ...s.ui, originDate: addDaysISO(s.ui.originDate, delta) } })),
    goToToday: () =>
      set((s) => ({
        ui: {
          ...s.ui,
          originDate: addDaysISO(todayISO(), DEFAULT_ORIGIN_OFFSET_DAYS),
          focusDate: todayISO(),
          recenterToken: s.ui.recenterToken + 1,
        },
      })),
    goToDate: (date) =>
      set((s) => ({
        ui: {
          ...s.ui,
          originDate: addDaysISO(date, DEFAULT_ORIGIN_OFFSET_DAYS),
          focusDate: date,
          recenterToken: s.ui.recenterToken + 1,
        },
      })),
    setDrawMode: (mode) => set((s) => ({ ui: { ...s.ui, drawMode: mode } })),
    selectAllocation: (id) => set((s) => ({ ui: { ...s.ui, selectedAllocationId: id } })),
    setFilters: (patch) => set((s) => ({ ui: { ...s.ui, filters: { ...s.ui.filters, ...patch } } })),
    clearFilters: () => set((s) => ({ ui: { ...s.ui, filters: emptyFilters() } })),
    toggleGroup: (key) =>
      set((s) => ({
        ui: {
          ...s.ui,
          collapsedGroups: s.ui.collapsedGroups.includes(key)
            ? s.ui.collapsedGroups.filter((k) => k !== key)
            : [...s.ui.collapsedGroups, key],
        },
      })),
  }
})
