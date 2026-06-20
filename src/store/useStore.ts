import { create } from 'zustand'
import { newId } from '@floaty/shared/lib/id'
import { addDaysISO, startOfWeekISO, todayISO } from '@floaty/shared/lib/dateMath'
import { DEFAULT_RANGE_DAYS, DEFAULT_ZOOM, PAST_BUFFER_DAYS, type WeeksZoom } from '../lib/schedulerConfig'
import {
  deleteClientCascade,
  deleteDisciplineCascade,
  deletePhaseCascade,
  deleteProjectCascade,
  deleteResourceCascade,
  deleteActivityCascade,
} from '@floaty/shared/lib/integrity'
import {
  assertAllocationRefs,
  assertDateRange,
  assertResourceExists,
  assertScopedRefs,
  deleteAccountCascade,
  findOwned as findOwnedIn,
  remapAndValidateImport,
} from '@floaty/shared/domain/mutations'
import {
  defaultSidebarOpen,
  readStoredBarLabelPrefs,
  readStoredFakeSignedIn,
  readStoredMinimiseWeekends,
  readStoredSidebarOpen,
  readStoredUtilizationPrefs,
  writeStoredBarLabelPrefs,
  writeStoredFakeSignedIn,
  writeStoredMinimiseWeekends,
  writeStoredSidebarOpen,
  writeStoredUtilizationPrefs,
  type BarLabelPrefs,
  type UtilizationPrefs,
} from '../lib/displayPrefs'
import { applyThemeToDom, readStoredTheme, writeStoredTheme, type ThemePref } from '../lib/theme'
import { buildInternalClient, isBuiltinClient } from '@floaty/shared/data/internalClient'
import { clampHoursPerDay, clampWorkingHoursPerDay, emptyAppData } from '@floaty/shared/types/entities'
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
  Activity,
  TimeOff,
  Weekday,
} from '@floaty/shared/types/entities'

// A Draft drops the server-owned fields (id/timestamps) AND `accountId` — the
// store stamps the active account, so callers never supply it.
//
// It ALSO drops `builtin` (a field only `Client` carries — `Omit` is a harmless no-op on every other
// entity): the built-in "Internal" client is minted exclusively by the privileged seed / addAccount /
// migrate paths, which construct the full Client record directly, NOT via addClient/updateClient.
// Public CRUD must NOT be able to create a SECOND builtin or promote a normal client to one — that
// would break the "exactly one Internal per account" invariant the scheduler / migrate / import all
// rely on. Excluding the field at the type level is the guard; the store also strips it defensively at
// runtime (see addClient/updateClient).
export type Draft<T extends Entity> = Omit<T, 'id' | 'accountId' | 'createdAt' | 'updatedAt' | 'builtin'>
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
  /** Activity lens: a specific internal/repeatable activity. Mutually exclusive with the
   *  client/project lens and with `activityKind` (enforced in setFilters). */
  activityId: ID | null
  /** Activity lens: ALL activities of a kind ('Internal — All' / 'Repeatable — All'). Mutually
   *  exclusive with the client/project lens and with `activityId`. */
  activityKind: 'internal' | 'repeatable' | null
  search: string
  hideTentative: boolean
  /** When a client/project/activity filter is active, ALSO show resources with no work on it
   *  (dimmed) so you can see who's free to staff. Off (the default) = filtering
   *  hides them, leaving only the matching resources' rows. */
  showUnmatched: boolean
}

export const emptyFilters = (): Filters => ({
  disciplineId: null,
  clientId: null,
  projectId: null,
  activityId: null,
  activityKind: null,
  search: '',
  hideTentative: false,
  showUnmatched: false,
})

export function hasActiveFilters(f: Filters): boolean {
  return (
    !!f.disciplineId ||
    !!f.clientId ||
    !!f.projectId ||
    !!f.activityId ||
    !!f.activityKind ||
    f.search.trim() !== '' ||
    f.hideTentative
  )
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
  /** Transient: when set, SchedulerGrid scrolls the given resource row into view.
   *  Token-per-request (like recenterToken) so the effect re-fires even for the
   *  same resource id. Never persisted; never on the undo stack. */
  scrollToResource: { id: ID; token: number } | null
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
  /** True when a REMOTE load failed (server down / network error) — distinct from
   *  loadError (corrupt LOCAL bytes). The app renders empty with no autosave attached,
   *  and a connection-error screen offers a retry. Clearing local storage (the
   *  StorageRecovery path) can't recover a server-backed app, so the two are kept apart. */
  connectionError: boolean
  /** Transient user message (e.g. a rejected drag) + its severity, as ONE value so the
   *  two can't desync. 'info' auto-dismisses; 'error' persists until dismissed (an error
   *  that vanishes before it's read is useless). Null = no notice. */
  notice: Notice | null
  /** True while an open form has unsaved edits — drives the unsaved-changes guards
   *  (modal backdrop/Escape, beforeunload). Set by the Modal, never persisted. */
  dirtyForm: boolean
  /** The allocation currently being dragged/resized, or null. Transient UI (like
   *  dirtyForm) — never persisted, never on the undo stack. Lets the scheduler PIN the
   *  dragged row so a mid-gesture vertical scroll can't virtualise it out and orphan the
   *  drag (the document pointer listeners would be torn down on unmount). */
  draggingAllocationId: ID | null
  /** Colour-scheme preference. Device-global, not part of account data: kept in the
   *  store only for reactivity, persisted to its own localStorage key by setTheme. */
  theme: ThemePref
  /** Utilisation display toggles. Device-global like `theme`, persisted to their
   *  own localStorage key — not part of account data. */
  utilizationPrefs: UtilizationPrefs
  /** Allocation-bar label toggles (client/project context before the activity name).
   *  Device-global like `utilizationPrefs`, own localStorage key. */
  barLabelPrefs: BarLabelPrefs
  /** Sidebar open (labels) vs collapsed (icon rail). Device-global like `theme`,
   *  own localStorage key; the first-run default is viewport-derived (collapsed
   *  on small screens, open on desktop). */
  sidebarOpen: boolean
  /** Shrink the weekend (Sat/Sun) columns on the schedule to a sliver. Device-global like
   *  `theme`, own localStorage key, NOT in AppData/export — and defaults ON. */
  minimiseWeekends: boolean
  /** COSMETIC demo "fake sign-in" state — gates a Google-style demo sign-in screen BEFORE
   *  the account picker so a viewer sees "log in first, then pick a company". Device-global
   *  like `theme` (own localStorage key, NOT in AppData/export), defaults OFF (signed out).
   *  NOT real auth — the real seam is `src/auth/`; the gate is active only when that auth is
   *  off. See `src/components/FakeSignIn.tsx`. */
  fakeSignedIn: boolean

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
  setConnectionError: (v: boolean) => void
  setNotice: (message: string | null, tone?: 'info' | 'error') => void
  setDirtyForm: (v: boolean) => void
  /** Mark/clear the allocation being dragged (drives the grid's drag-pin). */
  setDraggingAllocation: (id: ID | null) => void
  /** Set the colour-scheme preference: persist it, repaint the DOM, update state. */
  setTheme: (pref: ThemePref) => void
  /** Toggle a single utilisation display preference: persist and update state. */
  setUtilizationPref: (key: keyof UtilizationPrefs, value: boolean) => void
  /** Toggle a single bar-label display preference: persist and update state. */
  setBarLabelPref: (key: keyof BarLabelPrefs, value: boolean) => void
  /** Open/collapse the sidebar: persist the choice and update state. */
  setSidebarOpen: (open: boolean) => void
  /** Toggle the minimise-weekends preference: persist and update state. */
  setMinimiseWeekends: (value: boolean) => void
  /** Set the cosmetic fake-sign-in state: persist and update state. */
  setFakeSignedIn: (value: boolean) => void
  /** Sign out of the cosmetic demo: drop the active company AND the "back" breadcrumb, then
   *  clear the device-global flag so the demo sign-in shows again. Cosmetic only — never
   *  touches the real auth seam (`src/auth/`); both call sites are guarded by `authMode === 'off'`. */
  signOutDemo: () => void
  undo: () => void
  redo: () => void

  // --- Scoped entity CRUD (disciplines / resources / clients / projects / phases / activities /
  // allocations / time off). CONTRACT — identical for every add*/update*/delete* below, and
  // invisible in the signatures, so it lives here:
  //  • Runs against the ACTIVE account and is undoable (⌘Z).
  //  • THROWS an Error whose message is SAFE TO DISPLAY on a tenancy/integrity violation (a
  //    cross-account id, a dangling required FK, a reversed date range, an empty working-day set,
  //    or no active account). The store is the LAST line of defence ("forms reject; store
  //    backstops"), so these MUST throw — do not wrap them to swallow.
  //  • Silently NO-OPS on a STALE id (update/delete of a row not owned by the active account — e.g.
  //    a drag committed after an undo removed the row). That's a benign race, not corruption.
  //  • Callers that take USER INPUT must wrap the call in try/catch and surface e.message (see
  //    TimeOffForm / AllocationModal). A throw left uncaught surfaces only as a React error.
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

  addActivity: (input: Draft<Activity>) => Activity
  updateActivity: (id: ID, patch: Patch<Activity>) => void
  deleteActivity: (id: ID) => void

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
  /** Clear schedule filters (so the resource row is visible) then set
   *  scrollToResource — SchedulerGrid watches this to scroll the row into view.
   *  Transient UI: NOT persisted, NOT on the undo stack. */
  jumpToResource: (id: ID) => void
}

const stamp = () => {
  const now = new Date().toISOString()
  return { createdAt: now, updatedAt: now }
}
const touch = () => new Date().toISOString()

const defaultUI = (): SchedulerUI => {
  // Open on the current week: focusDate = this Monday (the grid scrolls it flush to
  // the left edge), with the timeline ORIGIN a PAST_BUFFER_DAYS back-buffer earlier —
  // off-screen history to the left, so scrolling back pans instead of overscrolling
  // into the browser's back-swipe. rangeDays covers buffer + forward span.
  const weekStart = startOfWeekISO(todayISO())
  return {
    zoom: DEFAULT_ZOOM,
    originDate: addDaysISO(weekStart, -PAST_BUFFER_DAYS),
    rangeDays: PAST_BUFFER_DAYS + DEFAULT_RANGE_DAYS,
    focusDate: weekStart,
    drawMode: 'work',
    selectedAllocationId: null,
    filters: emptyFilters(),
    collapsedGroups: [],
    recenterToken: 0,
    scrollToResource: null,
  }
}

const HISTORY_LIMIT = 50

export const useStore = create<StoreState>()((set, get) => {
  // Every data mutation goes through mutate(): it snapshots the previous data
  // onto the undo stack and clears the redo stack.
  //
  // DO NOT wrap mutate(), its producers, undo/redo, the assert* helpers, or importData in a
  // try/catch to "be safe". Their integrity throws are the store's whole point — the last line that
  // stops bad multi-tenant data being persisted. Swallowing here would convert a loud, fixable
  // rejection into SILENT data corruption (the explicit anti-goal; see DEFENSIVE-CODING.md §4). If
  // a producer throws, `set` never runs, so state is left untouched — a clean, atomic failure.
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

  // Value-level integrity backstop: a resource with zero working days has no capacity
  // any day. The form guards this, but the store is the last line so no path can persist
  // it. (The import path instead REPAIRS an empty set to Mon–Fri — see sanitizeImport.)
  const assertWorkingDays = (days: Weekday[]): void => {
    if (!days || days.length === 0) throw new Error('A resource must have at least one working day.')
  }

  // clampHoursPerDay (allocations, [0,24]) and clampWorkingHoursPerDay (resources, (0,24])
  // come from the shared core (entities.ts) so the store write boundary and the import
  // sanitiser apply the IDENTICAL clamp — no per-path drift.

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
    connectionError: false,
    notice: null,
    dirtyForm: false,
    draggingAllocationId: null,
    theme: readStoredTheme(),
    utilizationPrefs: readStoredUtilizationPrefs(),
    barLabelPrefs: readStoredBarLabelPrefs(),
    sidebarOpen: readStoredSidebarOpen() ?? defaultSidebarOpen(),
    minimiseWeekends: readStoredMinimiseWeekends(),
    fakeSignedIn: readStoredFakeSignedIn(),

    addAccount: (input) => {
      const ts = stamp()
      const e: Account = { ...input, id: newId(), ...ts }
      // Every new account gets its built-in "Internal" client (one per account; see
      // internalClient.ts). Created atomically with the account so the one-per-account invariant
      // holds the instant the tenant exists — matching seed() and the v5→v6 migrate.
      const internal = buildInternalClient(e.id, ts.createdAt)
      mutate((d) => ({ ...d, accounts: [...d.accounts, e], clients: [...d.clients, internal] }))
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
    setActiveAccount: (rawId) => {
      // A non-null id that matches NO account is a stale/unknown tenant. Surface it and drop to the
      // picker rather than silently activating a dead id — a dead id would pass requireAccount() and
      // render an empty schedule as if it were real (exactly the hidden-corruption class we guard
      // against). Never throw: null is legitimate and tests/recovery set ids; the picker is safe.
      let id = rawId
      if (id !== null && !get().data.accounts.some((a) => a.id === id)) {
        console.warn(`setActiveAccount: no company with id ${JSON.stringify(id)} — returning to the picker`)
        get().setNotice('That company no longer exists.', 'error')
        id = null
      }
      set((s) => {
        // Open the switched-into company on the current week (mirrors defaultUI) rather
        // than inheriting the previous tenant's panned origin/focus.
        const account = id ? s.data.accounts.find((a) => a.id === id) : null
        const tz = account?.timezone ?? 'Etc/GMT'
        const wso = account?.weekStartsOn ?? 1
        const weekStart = startOfWeekISO(todayISO(tz), wso)
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
            originDate: addDaysISO(weekStart, -PAST_BUFFER_DAYS),
            focusDate: weekStart,
          },
        }
      })
    },

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
      const result = remapAndValidateImport(get().data, accountId, incoming, touch())
      // Refuse a zero-record import rather than wiping the account's existing slice.
      // Replacing a company's data with nothing is never the intent (delete is the
      // explicit path for that), and a truncated/empty file otherwise slips past the
      // shape-only file guard and silently clears the account.
      if (result.imported === 0) return { imported: 0, skipped: result.skipped }
      mutate(() => result.data)
      return { imported: result.imported, skipped: result.skipped }
    },
    setHydrated: (v) => set({ hydrated: v }),
    setPersistError: (v) => set({ persistError: v }),
    setLoadError: (v) => set({ loadError: v }),
    setConnectionError: (v) => set({ connectionError: v }),
    setNotice: (message, tone = 'info') => set({ notice: message ? { message, tone } : null }),
    setDirtyForm: (v) => set({ dirtyForm: v }),
    // Plain set (NOT mutate): transient UI, must never land on the undo/redo stack.
    setDraggingAllocation: (id) => set({ draggingAllocationId: id }),
    setTheme: (pref) => {
      writeStoredTheme(pref)
      applyThemeToDom(pref)
      set({ theme: pref })
    },
    setUtilizationPref: (key, value) =>
      set((s) => {
        const next = { ...s.utilizationPrefs, [key]: value }
        writeStoredUtilizationPrefs(next)
        return { utilizationPrefs: next }
      }),
    setBarLabelPref: (key, value) =>
      set((s) => {
        const next = { ...s.barLabelPrefs, [key]: value }
        writeStoredBarLabelPrefs(next)
        return { barLabelPrefs: next }
      }),
    setSidebarOpen: (open) => {
      writeStoredSidebarOpen(open)
      set({ sidebarOpen: open })
    },
    setMinimiseWeekends: (value) => {
      writeStoredMinimiseWeekends(value)
      set({ minimiseWeekends: value })
    },
    // Plain set (NOT mutate): a device-global demo flag, never on the undo/redo stack,
    // never in AppData/export.
    setFakeSignedIn: (value) => {
      writeStoredFakeSignedIn(value)
      set({ fakeSignedIn: value })
    },
    // Reuse setActiveAccount(null) to drop the tenant and reset its view/undo state, then ALSO
    // clear previousAccountId (so re-signing-in is a fresh pick, not a one-click "← Back to {company}")
    // and the device-global flag. Cosmetic demo only — the real auth seam (src/auth/) is untouched.
    signOutDemo: () => {
      get().setActiveAccount(null)
      writeStoredFakeSignedIn(false)
      set({ previousAccountId: null, fakeSignedIn: false })
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
      assertWorkingDays(input.workingDays)
      // Clamp working hours/day (the store is the last line; the form caps it, but a non-form
      // or pre-blur-paste write must not persist NaN / 0 / >24h capacity). 0 is rejected (a
      // resource works a positive day) — distinct from an allocation, where 0 is legal.
      const e: Resource = { ...input, workingHoursPerDay: clampWorkingHoursPerDay(input.workingHoursPerDay), id: newId(), accountId, ...stamp() }
      mutate((d) => ({ ...d, resources: [...d.resources, e] }))
      return e
    },
    updateResource: (id, patch) => {
      const existing = findOwned(get().data, 'resources', id)
      if (!existing) return
      assertScopedRefs(get().data, existing.accountId, 'resources', patch)
      if (patch.workingDays !== undefined) assertWorkingDays(patch.workingDays)
      const safePatch =
        patch.workingHoursPerDay !== undefined
          ? { ...patch, workingHoursPerDay: clampWorkingHoursPerDay(patch.workingHoursPerDay) }
          : patch
      mutate((d) => ({ ...d, resources: updateById(d.resources, id, safePatch) }))
    },
    deleteResource: (id) => {
      if (!findOwned(get().data, 'resources', id)) return
      mutate((d) => deleteResourceCascade(d, id))
    },

    addClient: (input) => {
      // `builtin` is excluded from Draft<Client> at the type level (only seed/addAccount/migrate may
      // mint the one Internal per account). Strip it at runtime too so an untyped/cast payload can't
      // smuggle `builtin: true` past the compile-time guard and create a SECOND builtin — that would
      // break the "exactly one Internal per account" invariant. See Draft<Client>.
      const safe: Record<string, unknown> = { ...input }
      delete safe.builtin
      const e: Client = { ...(safe as Draft<Client>), id: newId(), accountId: requireAccount(), ...stamp() }
      mutate((d) => ({ ...d, clients: [...d.clients, e] }))
      return e
    },
    updateClient: (id, patch) => {
      const existing = findOwned(get().data, 'clients', id)
      if (!existing) return
      // The built-in Internal client is protected: it can't be renamed (or recoloured) — it's a
      // fixed bucket. Throw a display-safe message (the form catches + surfaces it; the UI also
      // hides the affordance). Surface, don't swallow — see DEFENSIVE-CODING.md.
      if (isBuiltinClient(existing)) throw new Error('The Internal client is built in and cannot be renamed.')
      // `builtin` is excluded from Patch<Client> at the type level; strip it at runtime too so an
      // untyped/cast patch can't PROMOTE a normal client to a second builtin (same invariant as above).
      const safePatch: Record<string, unknown> = { ...patch }
      delete safePatch.builtin
      mutate((d) => ({ ...d, clients: updateById(d.clients, id, safePatch as Patch<Client>) }))
    },
    deleteClient: (id) => {
      const existing = findOwned(get().data, 'clients', id)
      if (!existing) return
      // The built-in Internal client cannot be deleted — every account must keep exactly one.
      if (isBuiltinClient(existing)) throw new Error('The Internal client is built in and cannot be deleted.')
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

    addActivity: (input) => {
      const accountId = requireAccount()
      assertScopedRefs(get().data, accountId, 'activities', input)
      const e: Activity = { ...input, id: newId(), accountId, ...stamp() }
      mutate((d) => ({ ...d, activities: [...d.activities, e] }))
      return e
    },
    updateActivity: (id, patch) => {
      const existing = findOwned(get().data, 'activities', id)
      if (!existing) return
      // Validate the MERGED row (like updateAllocation), not the raw patch: a partial patch
      // touching only projectId OR only phaseId must still be checked for activity↔phase coherence
      // against the row's OTHER field — else a phaseId-only patch is wrongly rejected, or a
      // projectId-only patch silently leaves a stale cross-project phaseId the server rejects.
      assertScopedRefs(get().data, existing.accountId, 'activities', { ...existing, ...patch })
      mutate((d) => ({ ...d, activities: updateById(d.activities, id, patch) }))
    },
    deleteActivity: (id) => {
      if (!findOwned(get().data, 'activities', id)) return
      mutate((d) => deleteActivityCascade(d, id))
    },

    addAllocation: (input) => {
      const accountId = requireAccount()
      assertAllocation(get().data, accountId, input.resourceId, input.activityId)
      assertDateRange(input.startDate, input.endDate)
      const e: Allocation = { ...input, hoursPerDay: clampHoursPerDay(input.hoursPerDay), id: newId(), accountId, ...stamp() }
      mutate((d) => ({ ...d, allocations: [...d.allocations, e] }))
      return e
    },
    updateAllocation: (id, patch) => {
      const existing = findOwned(get().data, 'allocations', id)
      if (!existing) return // stale id (e.g. drag committed after an undo) → no-op
      if (patch.resourceId !== undefined || patch.activityId !== undefined) {
        assertAllocation(
          get().data,
          existing.accountId,
          patch.resourceId ?? existing.resourceId,
          patch.activityId ?? existing.activityId,
        )
      }
      // Validate the EFFECTIVE range (merged with the existing row), so a
      // note/status/reassign-only patch isn't rejected for omitting dates.
      assertDateRange(patch.startDate ?? existing.startDate, patch.endDate ?? existing.endDate)
      // Clamp hours/day on the way in (a drag-resize rescale can exceed a real day).
      const safePatch = patch.hoursPerDay !== undefined ? { ...patch, hoursPerDay: clampHoursPerDay(patch.hoursPerDay) } : patch
      mutate((d) => ({ ...d, allocations: updateById(d.allocations, id, safePatch) }))
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
        // Match the default view: focus the start of the current week (scrolled flush
        // to the left edge) with the back-buffer behind it for leftward scrolling.
        const account = s.activeAccountId ? s.data.accounts.find((a) => a.id === s.activeAccountId) : null
        const tz = account?.timezone ?? 'Etc/GMT'
        const wso = account?.weekStartsOn ?? 1
        const weekStart = startOfWeekISO(todayISO(tz), wso)
        return {
          ui: {
            ...s.ui,
            originDate: addDaysISO(weekStart, -PAST_BUFFER_DAYS),
            focusDate: weekStart,
            recenterToken: s.ui.recenterToken + 1,
          },
        }
      }),
    goToDate: (date) =>
      set((s) => ({
        ui: {
          ...s.ui,
          originDate: addDaysISO(date, -PAST_BUFFER_DAYS),
          focusDate: date,
          recenterToken: s.ui.recenterToken + 1,
        },
      })),
    setDrawMode: (mode) => set((s) => ({ ui: { ...s.ui, drawMode: mode } })),
    selectAllocation: (id) => set((s) => ({ ui: { ...s.ui, selectedAllocationId: id } })),
    setFilters: (patch) =>
      set((s) => {
        const next: Filters = { ...s.ui.filters, ...patch }
        // Standalone-lens rule, enforced in ONE tamper-proof place: client/project and the activity
        // lens (activityId/activityKind) are mutually-exclusive "what work" views. Setting one to a real
        // value clears the other (search, discipline and the toggles stay independent). Keyed on
        // a truthy value in the PATCH so clearing a filter to null never wipes the opposite lens.
        if (patch.activityId || patch.activityKind) {
          next.clientId = null
          next.projectId = null
        }
        if (patch.clientId || patch.projectId) {
          next.activityId = null
          next.activityKind = null
        }
        return { ui: { ...s.ui, filters: next } }
      }),
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
    // Transient UI (NOT mutate): clears filters so the row is visible, then bumps
    // scrollToResource so SchedulerGrid's effect scrolls the row into view.
    jumpToResource: (id) =>
      set((s) => ({
        ui: {
          ...s.ui,
          filters: emptyFilters(),
          scrollToResource: { id, token: (s.ui.scrollToResource?.token ?? 0) + 1 },
        },
      })),
  }
})
