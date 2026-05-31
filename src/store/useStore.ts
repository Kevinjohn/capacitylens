import { create } from 'zustand'
import { newId } from '../lib/id'
import { addDaysISO, startOfWeekISO, todayISO } from '../lib/dateMath'
import { DEFAULT_ORIGIN_OFFSET_DAYS, DEFAULT_RANGE_DAYS, DEFAULT_ZOOM, type WeeksZoom } from '../lib/schedulerConfig'
import {
  deleteClientCascade,
  deleteDisciplineCascade,
  deletePhaseCascade,
  deleteProjectCascade,
  deleteResourceCascade,
  deleteTaskCascade,
} from '../lib/integrity'
import {
  assertAllocationRefs,
  assertDateRange,
  assertResourceExists,
  assertScopedRefs,
  deleteAccountCascade,
  findOwned as findOwnedIn,
  remapAndValidateImport,
} from '../domain/mutations'
import { applyThemeToDom, readStoredTheme, writeStoredTheme, type ThemePref } from '../lib/theme'
import { emptyAppData } from '../types/entities'
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
  ScopedEntityKey,
  Task,
  TimeOff,
} from '../types/entities'

// A Draft drops the server-owned fields (id/timestamps) AND `accountId` — the
// store stamps the active account, so callers never supply it.
export type Draft<T extends Entity> = Omit<T, 'id' | 'accountId' | 'createdAt' | 'updatedAt'>
export type Patch<T extends Entity> = Partial<Draft<T>>

/** A transient toast message + severity. */
export interface Notice {
  message: string
  tone: 'info' | 'error'
}

/** Outcome of an import: how many records landed vs. were dropped as invalid
 *  (broken date range / dangling ref). Lets the UI report the delta honestly. */
export interface ImportSummary {
  imported: number
  skipped: number
}

// Re-exported for convenience.
export type { WeeksZoom }

export interface Filters {
  disciplineId: ID | null
  clientId: ID | null
  projectId: ID | null
  search: string
  hideTentative: boolean
  /** When a project/client filter is active, also show resources with NO work on it
   *  (dimmed) so you can see who's free to staff. Off = only matching resources. */
  showUnmatched: boolean
}

export const emptyFilters = (): Filters => ({
  disciplineId: null,
  clientId: null,
  projectId: null,
  search: '',
  hideTentative: false,
  showUnmatched: true,
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
  /** The account that was active before switching to the picker — lets the picker
   *  offer a "back" escape after an accidental "Switch company". Never persisted. */
  previousAccountId: ID | null
  past: AppData[]
  future: AppData[]
  persistError: boolean
  /** True when stored data existed but could not be read (corrupt JSON / failed
   *  migrate). Distinct from persistError (a WRITE failure): on a load error the
   *  app renders empty and autosave is intentionally NOT attached, so a recovery
   *  UI can offer reset/import/export without overwriting the unreadable bytes. */
  loadError: boolean
  /** Transient user message (e.g. a rejected drag) + its severity, as ONE value so the
   *  two can't desync. 'info' auto-dismisses; 'error' persists until dismissed (an error
   *  that vanishes before it's read is useless). Null = no notice. */
  notice: Notice | null
  /** True while an open form has unsaved edits — drives the unsaved-changes guards
   *  (modal backdrop/Escape, beforeunload). Set by the Modal, never persisted. */
  dirtyForm: boolean
  /** Colour-scheme preference. Device-global, not part of account data: kept in the
   *  store only for reactivity, persisted to its own localStorage key by setTheme. */
  theme: ThemePref

  addAccount: (input: Draft<Account>) => Account
  updateAccount: (id: ID, patch: Patch<Account>) => void
  deleteAccount: (id: ID) => void
  setActiveAccount: (id: ID | null) => void

  replaceAll: (data: AppData) => void
  /** Replace the active account's slice from an import; undoable via ⌘Z. Returns a
   *  summary of how many records were brought in vs. dropped as invalid. */
  importData: (data: AppData) => ImportSummary
  setHydrated: (v: boolean) => void
  setPersistError: (v: boolean) => void
  setLoadError: (v: boolean) => void
  setNotice: (message: string | null, tone?: 'info' | 'error') => void
  setDirtyForm: (v: boolean) => void
  /** Set the colour-scheme preference: persist it, repaint the DOM, update state. */
  setTheme: (pref: ThemePref) => void
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

const defaultUI = (): SchedulerUI => {
  // Open on the current week: origin = this Monday and focusDate = this Monday too,
  // so the first scroll lands flush at Monday (focus == origin → recenterLeftPad
  // clamps to 0) and the whole current week is visible from the left edge.
  const weekStart = startOfWeekISO(todayISO())
  return {
    zoom: DEFAULT_ZOOM,
    originDate: weekStart,
    rangeDays: DEFAULT_RANGE_DAYS,
    focusDate: weekStart,
    drawMode: 'work',
    selectedAllocationId: null,
    filters: emptyFilters(),
    collapsedGroups: [],
    recenterToken: 0,
  }
}

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

  // Tenancy + integrity rules now live in src/domain/mutations.ts (pure, shared
  // with a future server). findOwned is wrapped here to inject the active account
  // so the call sites stay terse; assertAllocation keeps its legacy name locally.
  // assertScopedRefs / assertDateRange / assertResourceExists are used directly
  // from the import above.
  const findOwned = <K extends ScopedEntityKey>(d: AppData, key: K, id: ID): AppData[K][number] | null =>
    findOwnedIn(d, requireAccount(), key, id)
  const assertAllocation = assertAllocationRefs

  return {
    data: emptyAppData(),
    ui: defaultUI(),
    hydrated: false,
    activeAccountId: null,
    previousAccountId: null,
    past: [],
    future: [],
    persistError: false,
    loadError: false,
    notice: null,
    dirtyForm: false,
    theme: readStoredTheme(),

    addAccount: (input) => {
      const e: Account = { ...input, id: newId(), ...stamp() }
      mutate((d) => ({ ...d, accounts: [...d.accounts, e] }))
      return e
    },
    updateAccount: (id, patch) => mutate((d) => ({ ...d, accounts: updateById(d.accounts, id, patch) })),
    // Cascade-drop every scoped entity belonging to this account; if it was the
    // active one, fall back to the picker.
    deleteAccount: (id) => {
      mutate((d) => deleteAccountCascade(d, id))
      if (get().activeAccountId === id) get().setActiveAccount(null)
    },
    // Switching tenant resets per-account view state and history — undo must never
    // cross an account boundary, and the previous account's filters/selection don't apply.
    setActiveAccount: (id) =>
      set((s) => {
        // Open the switched-into company on the current week (mirrors defaultUI) rather
        // than inheriting the previous tenant's panned origin/focus.
        const weekStart = startOfWeekISO(todayISO())
        return {
          activeAccountId: id,
          // Remember where we came from when dropping to the picker (id === null) so it
          // can offer a "back" escape; clear it once a tenant is actually chosen.
          previousAccountId: id === null ? s.activeAccountId : null,
          past: [],
          future: [],
          ui: {
            ...s.ui,
            filters: emptyFilters(),
            collapsedGroups: [],
            selectedAllocationId: null,
            originDate: weekStart,
            focusDate: weekStart,
          },
        }
      }),

    replaceAll: (data) => set({ data, past: [], future: [] }),
    // Replace only the active account's slice; other accounts and the account
    // list itself are untouched. Undoable via ⌘Z.
    //
    // Imported entities keep their relationships but are given FRESH ids. An
    // exported file carries the source account's ids; re-importing it into a
    // different account would otherwise collide — the store matches entities by
    // id GLOBALLY (updateById / cascade scan all accounts), so a shared id would
    // let an edit in one account silently rewrite another's row.
    importData: (incoming) => {
      const accountId = requireAccount()
      let summary: ImportSummary = { imported: 0, skipped: 0 }
      mutate((d) => {
        const result = remapAndValidateImport(d, accountId, incoming)
        summary = { imported: result.imported, skipped: result.skipped }
        return result.data
      })
      return summary
    },
    setHydrated: (v) => set({ hydrated: v }),
    setPersistError: (v) => set({ persistError: v }),
    setLoadError: (v) => set({ loadError: v }),
    setNotice: (message, tone = 'info') => set({ notice: message ? { message, tone } : null }),
    setDirtyForm: (v) => set({ dirtyForm: v }),
    setTheme: (pref) => {
      writeStoredTheme(pref)
      applyThemeToDom(pref)
      set({ theme: pref })
    },

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
    updateDiscipline: (id, patch) => {
      if (!findOwned(get().data, 'disciplines', id)) return
      mutate((d) => ({ ...d, disciplines: updateById(d.disciplines, id, patch) }))
    },
    deleteDiscipline: (id) => {
      if (!findOwned(get().data, 'disciplines', id)) return
      mutate((d) => deleteDisciplineCascade(d, id))
    },

    addResource: (input) => {
      const accountId = requireAccount()
      assertScopedRefs(get().data, accountId, 'resources', input)
      const e: Resource = { ...input, id: newId(), accountId, ...stamp() }
      mutate((d) => ({ ...d, resources: [...d.resources, e] }))
      return e
    },
    updateResource: (id, patch) => {
      const existing = findOwned(get().data, 'resources', id)
      if (!existing) return
      assertScopedRefs(get().data, existing.accountId, 'resources', patch)
      mutate((d) => ({ ...d, resources: updateById(d.resources, id, patch) }))
    },
    deleteResource: (id) => {
      if (!findOwned(get().data, 'resources', id)) return
      mutate((d) => deleteResourceCascade(d, id))
    },

    addClient: (input) => {
      const e: Client = { ...input, id: newId(), accountId: requireAccount(), ...stamp() }
      mutate((d) => ({ ...d, clients: [...d.clients, e] }))
      return e
    },
    updateClient: (id, patch) => {
      if (!findOwned(get().data, 'clients', id)) return
      mutate((d) => ({ ...d, clients: updateById(d.clients, id, patch) }))
    },
    deleteClient: (id) => {
      if (!findOwned(get().data, 'clients', id)) return
      mutate((d) => deleteClientCascade(d, id))
    },

    addProject: (input) => {
      const accountId = requireAccount()
      assertScopedRefs(get().data, accountId, 'projects', input)
      const e: Project = { ...input, id: newId(), accountId, ...stamp() }
      mutate((d) => ({ ...d, projects: [...d.projects, e] }))
      return e
    },
    updateProject: (id, patch) => {
      const existing = findOwned(get().data, 'projects', id)
      if (!existing) return
      assertScopedRefs(get().data, existing.accountId, 'projects', patch)
      mutate((d) => ({ ...d, projects: updateById(d.projects, id, patch) }))
    },
    deleteProject: (id) => {
      if (!findOwned(get().data, 'projects', id)) return
      mutate((d) => deleteProjectCascade(d, id))
    },

    addPhase: (input) => {
      const accountId = requireAccount()
      assertScopedRefs(get().data, accountId, 'phases', input)
      const e: Phase = { ...input, id: newId(), accountId, ...stamp() }
      mutate((d) => ({ ...d, phases: [...d.phases, e] }))
      return e
    },
    updatePhase: (id, patch) => {
      const existing = findOwned(get().data, 'phases', id)
      if (!existing) return
      assertScopedRefs(get().data, existing.accountId, 'phases', patch)
      mutate((d) => ({ ...d, phases: updateById(d.phases, id, patch) }))
    },
    deletePhase: (id) => {
      if (!findOwned(get().data, 'phases', id)) return
      mutate((d) => deletePhaseCascade(d, id))
    },

    addTask: (input) => {
      const accountId = requireAccount()
      assertScopedRefs(get().data, accountId, 'tasks', input)
      const e: Task = { ...input, id: newId(), accountId, ...stamp() }
      mutate((d) => ({ ...d, tasks: [...d.tasks, e] }))
      return e
    },
    updateTask: (id, patch) => {
      const existing = findOwned(get().data, 'tasks', id)
      if (!existing) return
      assertScopedRefs(get().data, existing.accountId, 'tasks', patch)
      mutate((d) => ({ ...d, tasks: updateById(d.tasks, id, patch) }))
    },
    deleteTask: (id) => {
      if (!findOwned(get().data, 'tasks', id)) return
      mutate((d) => deleteTaskCascade(d, id))
    },

    addAllocation: (input) => {
      const accountId = requireAccount()
      assertAllocation(get().data, accountId, input.resourceId, input.taskId)
      assertDateRange(input.startDate, input.endDate)
      const e: Allocation = { ...input, id: newId(), accountId, ...stamp() }
      mutate((d) => ({ ...d, allocations: [...d.allocations, e] }))
      return e
    },
    updateAllocation: (id, patch) => {
      const existing = findOwned(get().data, 'allocations', id)
      if (!existing) return // stale id (e.g. drag committed after an undo) → no-op
      if (patch.resourceId !== undefined || patch.taskId !== undefined) {
        assertAllocation(
          get().data,
          existing.accountId,
          patch.resourceId ?? existing.resourceId,
          patch.taskId ?? existing.taskId,
        )
      }
      // Validate the EFFECTIVE range (merged with the existing row), so a
      // note/status/reassign-only patch isn't rejected for omitting dates.
      assertDateRange(patch.startDate ?? existing.startDate, patch.endDate ?? existing.endDate)
      mutate((d) => ({ ...d, allocations: updateById(d.allocations, id, patch) }))
    },
    deleteAllocation: (id) => {
      if (!findOwned(get().data, 'allocations', id)) return
      mutate((d) => ({ ...d, allocations: d.allocations.filter((a) => a.id !== id) }))
    },

    addTimeOff: (input) => {
      const accountId = requireAccount()
      assertResourceExists(get().data, accountId, input.resourceId)
      assertDateRange(input.startDate, input.endDate)
      const e: TimeOff = { ...input, id: newId(), accountId, ...stamp() }
      mutate((d) => ({ ...d, timeOff: [...d.timeOff, e] }))
      return e
    },
    updateTimeOff: (id, patch) => {
      const existing = findOwned(get().data, 'timeOff', id)
      if (!existing) return
      if (patch.resourceId !== undefined) assertResourceExists(get().data, existing.accountId, patch.resourceId)
      assertDateRange(patch.startDate ?? existing.startDate, patch.endDate ?? existing.endDate)
      mutate((d) => ({ ...d, timeOff: updateById(d.timeOff, id, patch) }))
    },
    deleteTimeOff: (id) => {
      if (!findOwned(get().data, 'timeOff', id)) return
      mutate((d) => ({ ...d, timeOff: d.timeOff.filter((t) => t.id !== id) }))
    },

    setZoom: (zoom) => set((s) => ({ ui: { ...s.ui, zoom } })),
    setOriginDate: (date) => set((s) => ({ ui: { ...s.ui, originDate: date } })),
    panDays: (delta) => set((s) => ({ ui: { ...s.ui, originDate: addDaysISO(s.ui.originDate, delta) } })),
    goToToday: () =>
      set((s) => {
        // Match the default view: snap to the Monday of the current week so the full
        // week shows from the left edge (focus == origin → flush, no lead-in pad).
        const weekStart = startOfWeekISO(todayISO())
        return {
          ui: {
            ...s.ui,
            originDate: weekStart,
            focusDate: weekStart,
            recenterToken: s.ui.recenterToken + 1,
          },
        }
      }),
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
