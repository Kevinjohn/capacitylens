import { create } from 'zustand'
import { newId } from '@capacitylens/shared/lib/id'
import { addDaysISO, startOfWeekISO, todayISO } from '@capacitylens/shared/lib/dateMath'
import { DEFAULT_RANGE_DAYS, DEFAULT_ZOOM, PAST_BUFFER_DAYS, type WeeksZoom } from '../lib/schedulerConfig'
import {
  deleteClientCascade,
  deleteDisciplineCascade,
  deletePhaseCascade,
  deleteProjectCascade,
  deleteResourceCascade,
  deleteActivityCascade,
} from '@capacitylens/shared/lib/integrity'
import {
  assertAllocationRefs,
  assertDateRange,
  assertResourceExists,
  assertResourceKindAllowsDependents,
  assertScopedRefs,
  deleteAccountCascade,
  findOwned as findOwnedIn,
  remapAndValidateImport,
} from '@capacitylens/shared/domain/mutations'
import { archive, canPurge, obfuscateResource, PURGE_MIN_AGE_DAYS, softDelete, unarchive } from '@capacitylens/shared/domain/lifecycle'
import { m } from '@/i18n'
import {
  defaultSidebarOpen,
  readStoredBarLabelPrefs,
  readStoredFakeSignedIn,
  readStoredGettingStartedDismissed,
  readStoredIntroSeen,
  readStoredMinimiseWeekends,
  readStoredSidebarOpen,
  readStoredSnapToWeekStart,
  readStoredUtilizationPrefs,
  writeStoredBarLabelPrefs,
  writeStoredFakeSignedIn,
  writeStoredGettingStartedDismissed,
  writeStoredIntroSeen,
  writeStoredMinimiseWeekends,
  writeStoredSidebarOpen,
  writeStoredSnapToWeekStart,
  writeStoredUtilizationPrefs,
  type BarLabelPrefs,
  type UtilizationPrefs,
} from '../lib/displayPrefs'
import { applyThemeToDom, readStoredTheme, writeStoredTheme, type ThemePref } from '../lib/theme'
import type { Role } from '@capacitylens/shared/domain/access'
import { buildInternalClient, isBuiltinClient } from '@capacitylens/shared/data/internalClient'
import { clampHoursPerDay, clampWorkingHoursPerDay, emptyAppData } from '@capacitylens/shared/types/entities'
import { isPresetColor, NEUTRAL_COLOR, PRESET_COLORS } from '@capacitylens/shared/lib/color'
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
} from '@capacitylens/shared/types/entities'

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

// The three entity tables that carry the lifecycle tombstones (`archivedAt`/`deletedAt`, P2.1) and so
// can travel the Active → Archived → Soft-deleted → Purged machine (`shared/src/domain/lifecycle.ts`).
// MIRRORS the server's lifecycle-route entity union so the LOCAL store actions below and the server's
// dedicated routes (P2.5a) operate over the IDENTICAL set — phases/activities/allocations/timeOff/
// disciplines/accounts have no tombstone and are deliberately excluded.
export type LifecycleEntity = 'resources' | 'clients' | 'projects'

/**
 * A toast message + severity. Three tones, mapped to two dismissal behaviours by the AppShell
 * bridge (see the `notice` field below and AppShell's Sonner effect):
 *  - `'info'`    — a TRANSIENT confirmation (e.g. "Allocation moved"); auto-dismisses after ~4s.
 *  - `'warning'` — a non-error advisory the user MUST notice because it reports a DATA-MUTATING
 *    side-effect (e.g. a days-mode resize whose derived hours were CLAMPED, truncating work).
 *    Persists until dismissed (no fixed short timer) WITH a close affordance — WCAG 2.2.1 Timing
 *    Adjustable: a fixed 4s timer on the sole signal of a silent truncation fails Level A. Styled
 *    on the neutral surface (NOT the danger affordance), since the operation SUCCEEDED.
 *  - `'error'`   — a failure; persists until dismissed (an error that vanishes unread is useless)
 *    and carries the danger `.toast-error` accent.
 */
export interface Notice {
  message: string
  tone: 'info' | 'warning' | 'error'
}

/**
 * The minimal per-login account summary that drives the AccountPicker (P1.13) — the server-sourced
 * list of accounts this login may open. MIRRORS the server's `AccountSummary` (server/src/membership.ts)
 * so the `GET /api/accounts` wire shape maps straight in. Re-declared here (not imported) because the
 * server module is Node-only and out of the client build.
 *
 * This is kept SEPARATE from `data.accounts`: in server mode `data` holds only the ACTIVE account's
 * slice (one account), so the picker — which must list ALL the login's tenants — reads `accountSummaries`
 * instead. In the demo build the two are kept in lockstep (summaries derived from `data.accounts`).
 *
 * @property id    The `accountId` a subsequent `GET /api/state?accountId=…` hydrates.
 * @property name  The company name shown in the picker.
 * @property role  The caller's role for this account (OFF/demo supply 'owner' = full access).
 */
export interface AccountSummary {
  id: ID
  name: string
  role: Role
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
  /** Activity lens: a specific internal/cross-project activity. Mutually exclusive with the
   *  client/project lens and with `activityKind` (enforced in setFilters). */
  activityId: ID | null
  /** Activity lens: ALL activities of a kind ('Internal — All' / 'Cross-project — All'). Mutually
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
  /** The server-sourced list of accounts this login may open (P1.13) — the AccountPicker's data
   *  source. Set by useAccountSummaries: in server mode from `GET /api/accounts` (the login's
   *  memberships); in the demo build derived from `data.accounts`. SEPARATE from `data` because in
   *  server mode `data` holds only the ACTIVE account's slice, so it can't list the other tenants.
   *  Never persisted. */
  accountSummaries: AccountSummary[]
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
  /** User message (e.g. a rejected drag, or a clamp advisory) + its severity, as ONE value so the
   *  two can't desync. 'info' auto-dismisses (~4s); 'warning' and 'error' persist until dismissed —
   *  'warning' for a data-mutating advisory the user must notice (a fixed short timer on it fails
   *  WCAG 2.2.1), 'error' for a failure (an error that vanishes before it's read is useless). See
   *  {@link Notice}. Null = no notice. */
  notice: Notice | null
  /** Latest screen-reader capacity announcement (WCAG 4.1.3) + a monotonically-rising `seq`.
   *  A keyboard-committed allocation edit (move/resize) recomputes over-capacity, which mutates the
   *  silent per-row sr-only summary while focus stays on the bar — leaving a screen-reader user with
   *  NO feedback that their own edit flipped a day to over. AllocationBar fires `announceCapacity`
   *  AFTER such an edit; SchedulerGrid renders ONE polite aria-live region from this. The `seq`
   *  guarantees re-announcement even when consecutive edits yield the SAME text (an aria-live region
   *  re-reads only on a content change). Transient: never persisted, never on the undo stack. POINTER
   *  drags do NOT set this — they give sighted feedback and would be noise for everyone. Null = none yet. */
  srAnnouncement: { text: string; seq: number } | null
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
  /** After a FREE horizontal scroll settles, floor the grid's left edge to the current week's
   *  first day. Device-global like `theme` (own localStorage key, NOT in AppData/export), defaults
   *  ON. Governs FREE SCROLL ONLY — the navigation snap (zoom / Prev-Next / date-picker) is always
   *  on, independent of this flag. */
  snapToWeekStart: boolean
  /** COSMETIC demo "fake sign-in" state — gates a Google-style demo sign-in screen BEFORE
   *  the account picker so a viewer sees "log in first, then pick a company". Device-global
   *  like `theme` (own localStorage key, NOT in AppData/export), defaults OFF (signed out).
   *  NOT real auth — the real seam is `src/auth/`; the gate is active only when that auth is
   *  off. See `src/components/FakeSignIn.tsx`. */
  fakeSignedIn: boolean
  /** Whether the post-login "What CapacityLens is" intro page has been dismissed on this device.
   *  Device-global like `theme` (own localStorage key, NOT in AppData/export), defaults OFF so
   *  the intro shows once on first contact (after a company is chosen), then stays dismissed.
   *  Frequency is once per device by design (DECISIONS.md). See `src/components/IntroPage.tsx`. */
  introSeen: boolean
  /** Whether the schedule's first-run "Getting started" checklist card has been dismissed on this
   *  device. Device-global like `theme` (own localStorage key, NOT in AppData/export), defaults OFF
   *  so the checklist shows on first contact. The card also self-hides once every step is complete
   *  (derived live from scoped data) — this flag records only an explicit dismissal.
   *  See `src/components/GettingStarted.tsx`. */
  gettingStartedDismissed: boolean
  /** The caller's resolved {@link Role} for the ACTIVE account, or null. Set by PermissionProvider
   *  (P1.12) once it resolves the role from `GET /api/accounts`; null in OFF/local/not-fetched.
   *  Transient (never persisted, never on the undo stack). It powers ONLY the defense-in-depth
   *  mutation guard below (assertCanWrite): a scoped mutation NO-OPS when this is exactly 'viewer',
   *  so an ungated affordance or an optimistic write that the server would 403 can't desync local
   *  state. The server 403 (P1.5) is the TRUE security backstop — this is UX/defense-in-depth, NOT
   *  the access boundary, which is why ANY non-'viewer' value (incl. null = OFF/local) stays editable. */
  activeRole: Role | null

  addAccount: (input: Draft<Account>) => Account
  updateAccount: (id: ID, patch: Patch<Account>) => void
  deleteAccount: (id: ID) => void
  setActiveAccount: (id: ID | null) => void
  /** Replace the picker's server-sourced account list (P1.13). Called by useAccountSummaries with the
   *  result of `GET /api/accounts` (server mode) or the local derivation. Plain transient state. */
  setAccountSummaries: (list: AccountSummary[]) => void

  replaceAll: (data: AppData) => void
  /** Replace the active account's slice from an import; undoable via ⌘Z. Returns a
   *  summary of how many records were brought in vs. dropped as invalid. */
  importData: (data: AppData) => ImportSummary
  setHydrated: (v: boolean) => void
  setPersistError: (v: boolean) => void
  setLoadError: (v: boolean) => void
  setConnectionError: (v: boolean) => void
  setNotice: (message: string | null, tone?: 'info' | 'warning' | 'error') => void
  /** Announce a capacity outcome to the grid's polite aria-live region (WCAG 4.1.3). Bumps `seq`
   *  so the SAME text re-announces (an aria-live region re-reads only on a content change). Call
   *  ONLY after a successful KEYBOARD-committed allocation edit — pointer drags give sighted
   *  feedback and must not announce. Transient, never persisted/undone. */
  announceCapacity: (text: string) => void
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
  /** Toggle the snap-to-week-start preference: persist and update state. */
  setSnapToWeekStart: (value: boolean) => void
  /** Set the cosmetic fake-sign-in state: persist and update state. */
  setFakeSignedIn: (value: boolean) => void
  /** Mark the post-login intro page as seen on this device: persist and update state. */
  setIntroSeen: (value: boolean) => void
  /** Mark the "Getting started" checklist as dismissed on this device: persist and update state. */
  setGettingStartedDismissed: (value: boolean) => void
  /** Set the active account's resolved role (P1.12) — called by PermissionProvider whenever it
   *  resolves/changes the role (incl. back to null on OFF/local/account-switch). Plain transient
   *  state: never persisted, never on the undo stack. Drives ONLY the defense-in-depth write guard. */
  setActiveRole: (role: Role | null) => void
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

  addClient: (input: Draft<Client>) => Client
  updateClient: (id: ID, patch: Patch<Client>) => void

  addProject: (input: Draft<Project>) => Project
  updateProject: (id: ID, patch: Patch<Project>) => void

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

  // --- Data-lifecycle (P2.5b): the Active → Archived → Soft-deleted → Purged machine for the three
  // tombstone-carrying tables (resources / clients / projects). These are the DEMO-build / OFF path —
  // they mutate the local `data` blob through the same mutate()/undo machinery as the CRUD above. In
  // SERVER mode the UI instead calls the dedicated routes (POST /api/:entity/:id/{archive,unarchive,
  // delete,purge}, P2.5a) directly, so the admin view only invokes these in the demo build. They COMPOSE
  // the pure shared lifecycle helpers (shared/src/domain/lifecycle.ts) — the transition logic and the
  // soft-delete obfuscation string are NEVER re-derived here. Same contract as the CRUD: undoable,
  // viewer-no-op, stale-id-no-op, and the transition THROWS a display-safe Error on an invalid source
  // state (the UI gates with the can* predicates first; the throw is the defense-in-depth backstop).
  /** Archive an entity (active → archived). DEMO-build path; surface-not-swallow — `archive` throws
   *  if the row isn't active. @param entity which tombstone table. @param id the row to archive. */
  archiveEntity: (entity: LifecycleEntity, id: ID) => void
  /** Un-archive an entity (archived → active). DEMO-build path; `unarchive` throws if the row isn't
   *  archived. @param entity which tombstone table. @param id the row to restore. */
  unarchiveEntity: (entity: LifecycleEntity, id: ID) => void
  /** Soft-delete an entity (archived → deleted tombstone). DEMO-build path; `softDelete` throws unless
   *  the row is archived first (the lifecycle requires prior archival). For a `resources` row the
   *  tombstone's `name` is ALSO scrubbed via the shared `obfuscateResource` — the local copy retains
   *  no original PII while it awaits purge. @param entity which tombstone table. @param id the row. */
  softDeleteEntity: (entity: LifecycleEntity, id: ID) => void
  /** Hard-purge a soft-deleted tombstone (physically remove + cascade its children). DEMO-build path.
   *  Enforces the {@link PURGE_MIN_AGE_DAYS} grace window via `canPurge`: if the tombstone is too young
   *  it does NOT mutate and surfaces an error notice instead of throwing (a refused affordance, not a
   *  bug). @param entity which tombstone table. @param id the tombstone to purge. */
  purgeEntity: (entity: LifecycleEntity, id: ID) => void

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
// Take an ARRAY, not rest args: the whole-tenant callers (nextDataRevision, prepareHistoryTarget)
// pass one timestamp per row, and spreading tens of thousands of rows as function arguments can
// overflow the engine's argument limit (RangeError), failing an undo/redo or cascade-delete
// outright. Iterating an array is unbounded-safe. `touchAfter` keeps the ergonomic variadic shape
// for the many few-arg callers by delegating here.
const touchAfterAll = (timestamps: Array<string | undefined>): string => {
  let next = Date.now()
  for (const value of timestamps) {
    if (!value) continue
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed) && parsed >= next) next = parsed + 1
  }
  return new Date(next).toISOString()
}
const touchAfter = (...timestamps: Array<string | undefined>): string => touchAfterAll(timestamps)
const dataTimestamps = (data: AppData): string[] =>
  (Object.values(data) as Entity[][]).flatMap((rows) => rows.map((row) => row.updatedAt))
const nextDataRevision = (data: AppData): string =>
  touchAfterAll(dataTimestamps(data))

/**
 * Undo/redo restores historical values, but `updatedAt` is a synchronization revision rather than
 * user history. Re-stamp every surviving row whose content changes across the history transition;
 * otherwise the diff engine either misses a restored FK or the server rejects the old timestamp as
 * stale. Rows recreated from deletion need no stamp because the server has no current row to beat.
 */
function prepareHistoryTarget(current: AppData, target: AppData): AppData {
  const now = touchAfterAll(dataTimestamps(current).concat(dataTimestamps(target)))
  const retime = <T extends Entity>(beforeRows: T[], targetRows: T[]): T[] => {
    const beforeById = new Map(beforeRows.map((row) => [row.id, row]))
    const content = (row: T): string => JSON.stringify({ ...row, updatedAt: undefined })
    return targetRows.map((row) => {
      const before = beforeById.get(row.id)
      return before && content(before) !== content(row) ? { ...row, updatedAt: now } : row
    })
  }
  return {
    accounts: retime(current.accounts, target.accounts),
    disciplines: retime(current.disciplines, target.disciplines),
    resources: retime(current.resources, target.resources),
    clients: retime(current.clients, target.clients),
    projects: retime(current.projects, target.projects),
    phases: retime(current.phases, target.phases),
    activities: retime(current.activities, target.activities),
    allocations: retime(current.allocations, target.allocations),
    timeOff: retime(current.timeOff, target.timeOff),
  }
}

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

  // Erasure/purge actions must not leave a recoverable pre-erasure snapshot in memory. They also
  // cannot honestly be undoable, so clear both history directions as part of the same state write.
  const mutateIrreversible = (producer: (d: AppData) => AppData) =>
    set((s) => ({ data: producer(s.data), past: [], future: [] }))

  const updateById = <T extends Entity>(list: T[], id: ID, patch: Partial<Omit<T, keyof Entity>>): T[] =>
    list.map((x) => (x.id === id ? { ...x, ...patch, updatedAt: touchAfter(x.updatedAt) } : x))

  // Every scoped add* stamps the active account. With no account chosen there's
  // nowhere to file the entity, so we fail loudly rather than create an orphan.
  const requireAccount = (): ID => {
    const id = get().activeAccountId
    if (!id) throw new Error('No active account — cannot mutate scoped data.')
    return id
  }

  // Defense-in-depth viewer guard (P1.12). It is INERT unless the active role is EXACTLY 'viewer':
  // every other value — null (OFF/local/not-fetched), 'owner', 'admin', 'editor' — permits, so the
  // default deploy is byte-identical to today (fully editable). When the role IS 'viewer', a scoped
  // mutation NO-OPS (the caller returns early) and surfaces a notice, so an ungated affordance or an
  // optimistic local write the server would 403 can't desync local state. This is UX/defense-in-depth,
  // NOT the security boundary — the server 403 (P1.5) is the true backstop; we never throw here (a
  // throw would read as corruption and could crash a drag handler), we just refuse + inform.
  const blockedByViewer = (): boolean => {
    if (get().activeRole !== 'viewer') return false
    get().setNotice(m.notice_viewer_read_only(), 'error')
    return true
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
    if (
      !Array.isArray(days) ||
      days.length === 0 ||
      new Set(days).size !== days.length ||
      days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
    ) {
      throw new Error('At least one working day is required, using unique whole-number weekdays from 0 to 6.')
    }
  }
  const repairColor = (color: unknown, allowNeutral = false): string =>
    isPresetColor(color) || (allowNeutral && color === NEUTRAL_COLOR) ? color : PRESET_COLORS[0]

  // clampHoursPerDay (allocations, [0,24]) and clampWorkingHoursPerDay (resources, (0,24])
  // come from the shared core (entities.ts) so the store write boundary and the import
  // sanitiser apply the IDENTICAL clamp — no per-path drift.

  return {
    data: emptyAppData(),
    ui: defaultUI(),
    hydrated: false,
    activeAccountId: null,
    previousAccountId: null,
    accountSummaries: [],
    past: [],
    future: [],
    persistError: false,
    loadError: false,
    connectionError: false,
    notice: null,
    srAnnouncement: null,
    dirtyForm: false,
    draggingAllocationId: null,
    theme: readStoredTheme(),
    utilizationPrefs: readStoredUtilizationPrefs(),
    barLabelPrefs: readStoredBarLabelPrefs(),
    sidebarOpen: readStoredSidebarOpen() ?? defaultSidebarOpen(),
    minimiseWeekends: readStoredMinimiseWeekends(),
    snapToWeekStart: readStoredSnapToWeekStart(),
    fakeSignedIn: readStoredFakeSignedIn(),
    introSeen: readStoredIntroSeen(),
    gettingStartedDismissed: readStoredGettingStartedDismissed(),
    activeRole: null,

    addAccount: (input) => {
      const ts = stamp()
      // New-company defaults for the per-account view settings: brand-new tenants start in 'days'
      // scheduling with disciplines OFF, placeholder + external features hidden, and Internal work
      // grey. `...input`
      // comes LAST so a caller (or an import path) can still override any of them; existing/seed
      // accounts that never pass through addAccount keep their absent-field defaults (read via the
      // selectors). placeholdersEnabled/externalEnabled were device-global prefs and are now
      // per-account, mirroring disciplinesEnabled.
      const e: Account = {
        schedulingMode: 'days',
        disciplinesEnabled: false,
        placeholdersEnabled: false,
        externalEnabled: false,
        internalColourMode: 'grey',
        ...input,
        color: repairColor(input.color),
        id: newId(),
        ...ts,
      }
      // Every new account gets its built-in "Internal" client (one per account; see
      // internalClient.ts). Created atomically with the account so the one-per-account invariant
      // holds the instant the tenant exists — matching seed() and the v5→v6 migrate.
      const internal = buildInternalClient(e.id, ts.createdAt)
      mutate((d) => ({ ...d, accounts: [...d.accounts, e], clients: [...d.clients, internal] }))
      // Keep the picker's list in lockstep (P1.13). This action now runs only in the DEMO build —
      // server-mode create goes through the AccountPicker's dedicated POST /api/orgs path, not here —
      // so this append is the demo bookkeeping that keeps the picker synchronously fresh before the
      // useAccountSummaries derive effect flushes. Append only if absent so a derive that already
      // added it can't duplicate.
      set((s) =>
        s.accountSummaries.some((a) => a.id === e.id)
          ? {}
          : { accountSummaries: [...s.accountSummaries, { id: e.id, name: e.name, role: 'owner' as const }] },
      )
      return e
    },
    updateAccount: (id, patch) => {
      if (blockedByViewer()) return
      const safePatch = patch.color === undefined ? patch : { ...patch, color: repairColor(patch.color) }
      mutate((d) => ({ ...d, accounts: updateById(d.accounts, id, safePatch) }))
    },
    // Cascade-drop every scoped entity belonging to this account; if it was the
    // active one, fall back to the picker.
    deleteAccount: (id) => {
      if (blockedByViewer()) return
      mutateIrreversible((d) => deleteAccountCascade(d, id))
      // Drop it from the picker's list too (P1.13). This action now runs only in the DEMO build —
      // server-mode delete goes through the AccountPicker's dedicated DELETE /api/accounts/:id route,
      // not here — so this filter is the demo bookkeeping that keeps the picker synchronously fresh
      // before the useAccountSummaries derive effect flushes.
      set((s) => ({ accountSummaries: s.accountSummaries.filter((a) => a.id !== id) }))
      if (get().activeAccountId === id) get().setActiveAccount(null)
    },
    // Switching tenant resets per-account view state and history — undo must never
    // cross an account boundary, and the previous account's filters/selection don't apply.
    setActiveAccount: (rawId) => {
      // A non-null id that matches NO account is a stale/unknown tenant. Surface it and drop to the
      // picker rather than silently activating a dead id — a dead id would pass requireAccount() and
      // render an empty schedule as if it were real (exactly the hidden-corruption class we guard
      // against). Never throw: null is legitimate and tests/recovery set ids; the picker is safe.
      //
      // EXISTENCE = the UNION of `data.accounts` (the demo build, and the active slice in server mode) AND
      // `accountSummaries` (server mode, where `data` holds only the active account's slice so a
      // not-yet-loaded tenant is absent from data but present in the summaries the picker showed). The
      // persist switch orchestrator then loads that account's slice into `data`; this validation only
      // proves the id is one the login may open, not that its data is loaded yet.
      let id = rawId
      if (
        id !== null &&
        !get().data.accounts.some((a) => a.id === id) &&
        !get().accountSummaries.some((a) => a.id === id)
      ) {
        console.warn(`setActiveAccount: no company with id ${JSON.stringify(id)} — returning to the picker`)
        get().setNotice(m.notice_company_not_found(), 'error')
        id = null
      }
      set((s) => {
        // Open the switched-into company on the current week (mirrors defaultUI) rather
        // than inheriting the previous tenant's panned origin/focus. The account's tz/weekStartsOn
        // come from its slice when loaded; in server mode the slice loads a frame later (the switch
        // orchestrator awaits the fetch), so fall back to the existing defaults for that one frame
        // (an acceptable transient — the grid re-anchors when the slice arrives via replaceAll).
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

    // Plain set (NOT mutate): the picker's account list is transient, server-sourced, never on the
    // undo/redo stack, never in AppData/export.
    setAccountSummaries: (list) => set({ accountSummaries: list }),

    replaceAll: (data) => set((state) => {
      const previouslyHadActiveAccount = state.activeAccountId
        ? state.data.accounts.some((candidate) => candidate.id === state.activeAccountId)
        : false
      const account = state.activeAccountId
        ? data.accounts.find((candidate) => candidate.id === state.activeAccountId)
        : undefined
      // Same-account refreshes reconcile server state in the background and must preserve the
      // week the user is viewing. Re-anchor only when setActiveAccount had to use its temporary
      // GMT/Monday fallback because the selected account was absent from the previous slice.
      if (!account || previouslyHadActiveAccount) return { data, past: [], future: [] }
      const weekStart = startOfWeekISO(todayISO(account.timezone ?? 'Etc/GMT'), account.weekStartsOn ?? 1)
      return {
        data,
        past: [],
        future: [],
        ui: {
          ...state.ui,
          originDate: addDaysISO(weekStart, -PAST_BUFFER_DAYS),
          focusDate: weekStart,
        },
      }
    }),
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
      // Viewer no-op (P1.12 defense-in-depth): a read-only user can't replace the account slice.
      // Return a zero-effect summary (nothing imported/skipped) so the caller reports honestly.
      if (blockedByViewer()) return { imported: 0, skipped: 0 }
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
    // ^ Tone → dismissal behaviour is owned by the AppShell→Sonner bridge: 'info' auto-dismisses
    //   (~4s), 'warning'/'error' persist (duration: Infinity) with a close button. See {@link Notice}.
    // Plain set (NOT mutate): transient a11y signal, must never land on the undo/redo stack.
    // Bump seq off the PREVIOUS announcement so identical consecutive text still re-announces.
    announceCapacity: (text) => set((s) => ({ srAnnouncement: { text, seq: (s.srAnnouncement?.seq ?? 0) + 1 } })),
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
    setSnapToWeekStart: (value) => {
      writeStoredSnapToWeekStart(value)
      set({ snapToWeekStart: value })
    },
    // Plain set (NOT mutate): a device-global demo flag, never on the undo/redo stack,
    // never in AppData/export.
    setFakeSignedIn: (value) => {
      writeStoredFakeSignedIn(value)
      set({ fakeSignedIn: value })
    },
    // Plain set (NOT mutate): a device-global view flag, never on the undo/redo stack,
    // never in AppData/export.
    setIntroSeen: (value) => {
      writeStoredIntroSeen(value)
      set({ introSeen: value })
    },
    // Plain set (NOT mutate): a device-global view flag, never on the undo/redo stack,
    // never in AppData/export.
    setGettingStartedDismissed: (value) => {
      writeStoredGettingStartedDismissed(value)
      set({ gettingStartedDismissed: value })
    },
    // Plain set (NOT mutate): transient access state, never persisted, never on the undo/redo stack,
    // never in AppData/export. Drives ONLY the inert-unless-viewer write guard above.
    setActiveRole: (role) => set({ activeRole: role }),
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
        if (s.activeRole === 'viewer') return {}
        if (s.past.length === 0) return {}
        const previous = prepareHistoryTarget(s.data, s.past[s.past.length - 1])
        return { data: previous, past: s.past.slice(0, -1), future: [s.data, ...s.future].slice(0, HISTORY_LIMIT) }
      }),
    redo: () =>
      set((s) => {
        if (s.activeRole === 'viewer') return {}
        if (s.future.length === 0) return {}
        const next = prepareHistoryTarget(s.data, s.future[0])
        return { data: next, future: s.future.slice(1), past: [...s.past, s.data].slice(-HISTORY_LIMIT) }
      }),

    addDiscipline: (input) => {
      const e: Discipline = { ...input, ...(input.color === undefined ? {} : { color: repairColor(input.color) }), id: newId(), accountId: requireAccount(), ...stamp() }
      // Viewer no-op (P1.12 defense-in-depth): build the entity so the return type holds, but skip
      // the persist — nothing lands in state. Server 403 is the real backstop; see blockedByViewer.
      if (blockedByViewer()) return e
      mutate((d) => ({ ...d, disciplines: [...d.disciplines, e] }))
      return e
    },
    updateDiscipline: (id, patch) => {
      if (blockedByViewer()) return
      if (!findOwned(get().data, 'disciplines', id)) return
      const safePatch = patch.color === undefined ? patch : { ...patch, color: repairColor(patch.color) }
      mutate((d) => ({ ...d, disciplines: updateById(d.disciplines, id, safePatch) }))
    },
    deleteDiscipline: (id) => {
      if (blockedByViewer()) return
      if (!findOwned(get().data, 'disciplines', id)) return
      mutate((d) => deleteDisciplineCascade(d, id, nextDataRevision(d)))
    },

    addResource: (input) => {
      const accountId = requireAccount()
      // Viewer no-op (P1.12 defense-in-depth): gate BEFORE the integrity asserts so a read-only user's
      // optimistic write neither validates nor persists. Build the (clamped) entity so the return type
      // holds; it never lands in state. Server 403 is the real backstop; see blockedByViewer.
      const e: Resource = { ...input, color: repairColor(input.color, input.kind === 'external'), workingHoursPerDay: clampWorkingHoursPerDay(input.workingHoursPerDay), id: newId(), accountId, ...stamp() }
      if (blockedByViewer()) return e
      assertScopedRefs(get().data, accountId, 'resources', input)
      assertWorkingDays(input.workingDays)
      // Clamp working hours/day (the store is the last line; the form caps it, but a non-form
      // or pre-blur-paste write must not persist NaN / 0 / >24h capacity). 0 is rejected (a
      // resource works a positive day) — distinct from an allocation, where 0 is legal.
      mutate((d) => ({ ...d, resources: [...d.resources, e] }))
      return e
    },
    updateResource: (id, patch) => {
      if (blockedByViewer()) return
      const existing = findOwned(get().data, 'resources', id)
      if (!existing) return
      // `existing` enables the unchanged-parent relaxation (see assertScopedRefs): an unchanged
      // placeholder projectId whose project is ARCHIVED (absent from the server-mode active-only
      // slice) must not block an unrelated edit; a CHANGED projectId is still validated strictly.
      assertScopedRefs(get().data, existing.accountId, 'resources', patch, existing)
      // Flipping a resource to external while it still owns loaded work / time-off would orphan those
      // dependents (the scheduler hides external capacity + time-off). Reject the flip on the MERGED
      // kind, throw-before-mutate so the failure is atomic. A no-op when the resource isn't becoming
      // external. Mirrors the server's validateWrite resources branch — same shared assert, no drift.
      assertResourceKindAllowsDependents(get().data, existing.accountId, id, patch.kind ?? existing.kind)
      if (patch.workingDays !== undefined) assertWorkingDays(patch.workingDays)
      const colorPatch = patch.color === undefined ? patch : { ...patch, color: repairColor(patch.color, (patch.kind ?? existing.kind) === 'external') }
      const safePatch =
        patch.workingHoursPerDay !== undefined
          ? { ...colorPatch, workingHoursPerDay: clampWorkingHoursPerDay(patch.workingHoursPerDay) }
          : colorPatch
      mutate((d) => ({ ...d, resources: updateById(d.resources, id, safePatch) }))
    },

    addClient: (input) => {
      // STORE-STRIP enforcement point (1) of the single-Internal invariant — see the canonical doc in
      // shared/src/data/internalClient.ts (the other two points are import fold + server reject).
      // `builtin` is excluded from Draft<Client> at the type level (only seed/addAccount/migrate may
      // mint the one Internal per account). Strip it at runtime too so an untyped/cast payload can't
      // smuggle `builtin: true` past the compile-time guard and create a SECOND builtin — that would
      // break the "exactly one Internal per account" invariant. See Draft<Client>.
      const safe: Record<string, unknown> = { ...input }
      delete safe.builtin
      const e: Client = { ...(safe as Draft<Client>), color: repairColor(safe.color), id: newId(), accountId: requireAccount(), ...stamp() }
      // Viewer no-op (P1.12 defense-in-depth): build the entity for the return type, skip the persist.
      if (blockedByViewer()) return e
      mutate((d) => ({ ...d, clients: [...d.clients, e] }))
      return e
    },
    updateClient: (id, patch) => {
      if (blockedByViewer()) return
      const existing = findOwned(get().data, 'clients', id)
      if (!existing) return
      // The built-in Internal client is protected: it can't be renamed (or recoloured) — it's a
      // fixed bucket. Throw a display-safe message (the form catches + surfaces it; the UI also
      // hides the affordance). Surface, don't swallow — see DEFENSIVE-CODING.md.
      if (isBuiltinClient(existing)) throw new Error('The Internal client is built in and cannot be renamed.')
      // `builtin` is excluded from Patch<Client> at the type level; strip it at runtime too so an
      // untyped/cast patch can't PROMOTE a normal client to a second builtin (same invariant as above —
      // store-strip enforcement point (1); canonical doc in shared/src/data/internalClient.ts).
      const safePatch: Record<string, unknown> = { ...patch }
      delete safePatch.builtin
      if (safePatch.color !== undefined) safePatch.color = repairColor(safePatch.color)
      mutate((d) => ({ ...d, clients: updateById(d.clients, id, safePatch as Patch<Client>) }))
    },

    addProject: (input) => {
      const accountId = requireAccount()
      const e: Project = { ...input, color: repairColor(input.color), id: newId(), accountId, ...stamp() }
      // Viewer no-op (P1.12 defense-in-depth): gate before the asserts; build the entity, skip persist.
      if (blockedByViewer()) return e
      assertScopedRefs(get().data, accountId, 'projects', input)
      mutate((d) => ({ ...d, projects: [...d.projects, e] }))
      return e
    },
    updateProject: (id, patch) => {
      if (blockedByViewer()) return
      const existing = findOwned(get().data, 'projects', id)
      if (!existing) return
      // `existing` enables the unchanged-parent relaxation (see assertScopedRefs): in server mode
      // the hydrated slice is active-only, so an unchanged clientId pointing at an ARCHIVED client
      // must not block an unrelated edit; a CHANGED clientId is still validated strictly.
      assertScopedRefs(get().data, existing.accountId, 'projects', patch, existing)
      const safePatch = patch.color === undefined ? patch : { ...patch, color: repairColor(patch.color) }
      mutate((d) => ({ ...d, projects: updateById(d.projects, id, safePatch) }))
    },

    addPhase: (input) => {
      const accountId = requireAccount()
      const e: Phase = { ...input, id: newId(), accountId, ...stamp() }
      // Viewer no-op (P1.12 defense-in-depth): gate before the asserts; build the entity, skip persist.
      if (blockedByViewer()) return e
      assertScopedRefs(get().data, accountId, 'phases', input)
      mutate((d) => ({ ...d, phases: [...d.phases, e] }))
      return e
    },
    updatePhase: (id, patch) => {
      if (blockedByViewer()) return
      const existing = findOwned(get().data, 'phases', id)
      if (!existing) return
      // `existing` enables the unchanged-parent relaxation (see assertScopedRefs) — same
      // archived-parent rationale as updateProject above.
      assertScopedRefs(get().data, existing.accountId, 'phases', patch, existing)
      mutate((d) => ({ ...d, phases: updateById(d.phases, id, patch) }))
    },
    deletePhase: (id) => {
      if (blockedByViewer()) return
      if (!findOwned(get().data, 'phases', id)) return
      mutate((d) => deletePhaseCascade(d, id, nextDataRevision(d)))
    },

    addActivity: (input) => {
      const accountId = requireAccount()
      const e: Activity = { ...input, id: newId(), accountId, ...stamp() }
      // Viewer no-op (P1.12 defense-in-depth): gate before the asserts; build the entity, skip persist.
      if (blockedByViewer()) return e
      assertScopedRefs(get().data, accountId, 'activities', input)
      mutate((d) => ({ ...d, activities: [...d.activities, e] }))
      return e
    },
    updateActivity: (id, patch) => {
      if (blockedByViewer()) return
      const existing = findOwned(get().data, 'activities', id)
      if (!existing) return
      // Validate the MERGED row (like updateAllocation), not the raw patch: a partial patch
      // touching only projectId OR only phaseId must still be checked for activity↔phase coherence
      // against the row's OTHER field — else a phaseId-only patch is wrongly rejected, or a
      // projectId-only patch silently leaves a stale cross-project phaseId the server rejects.
      // `existing` enables the unchanged-parent relaxation (see assertScopedRefs): an unchanged
      // projectId whose project is ARCHIVED (absent from the server-mode active-only slice) must
      // not block an unrelated edit; a CHANGED projectId is still validated strictly.
      assertScopedRefs(get().data, existing.accountId, 'activities', { ...existing, ...patch }, existing)
      mutate((d) => ({ ...d, activities: updateById(d.activities, id, patch) }))
    },
    deleteActivity: (id) => {
      if (blockedByViewer()) return
      if (!findOwned(get().data, 'activities', id)) return
      mutate((d) => deleteActivityCascade(d, id))
    },

    addAllocation: (input) => {
      const accountId = requireAccount()
      const e: Allocation = { ...input, hoursPerDay: clampHoursPerDay(input.hoursPerDay), id: newId(), accountId, ...stamp() }
      // Viewer no-op (P1.12 defense-in-depth): gate before the asserts; build the entity, skip persist.
      if (blockedByViewer()) return e
      assertAllocation(get().data, accountId, input.resourceId, input.activityId, input.hoursPerDay)
      assertDateRange(input.startDate, input.endDate)
      mutate((d) => ({ ...d, allocations: [...d.allocations, e] }))
      return e
    },
    updateAllocation: (id, patch) => {
      if (blockedByViewer()) return
      const existing = findOwned(get().data, 'allocations', id)
      if (!existing) return // stale id (e.g. drag committed after an undo) → no-op
      // Always re-validate the EFFECTIVE MERGED row (patch ?? existing), not just when one of the
      // ref/load fields is in the patch. The server re-runs assertAllocationRefs on the full merged
      // row on EVERY write (PATCH/PUT merge {...existing, ...patch}), so a note/status/date-only edit
      // of an allocation whose resource is now EXTERNAL with a non-zero load (legacy pre-v0.8.1 data,
      // or after a resource kind-flip) would 400 on the server while succeeding here — diverging local
      // and synced state. Matching the merged-row check makes the store reject exactly what the server
      // rejects. It's a pure read — a note-only patch on a valid (non-external) row still passes.
      assertAllocation(
        get().data,
        existing.accountId,
        patch.resourceId ?? existing.resourceId,
        patch.activityId ?? existing.activityId,
        patch.hoursPerDay ?? existing.hoursPerDay,
        existing,
      )
      // Validate the EFFECTIVE range (merged with the existing row), so a
      // note/status/reassign-only patch isn't rejected for omitting dates.
      assertDateRange(patch.startDate ?? existing.startDate, patch.endDate ?? existing.endDate)
      // Clamp hours/day on the way in (a drag-resize rescale can exceed a real day).
      const safePatch = patch.hoursPerDay !== undefined ? { ...patch, hoursPerDay: clampHoursPerDay(patch.hoursPerDay) } : patch
      mutate((d) => ({ ...d, allocations: updateById(d.allocations, id, safePatch) }))
    },
    deleteAllocation: (id) => {
      if (blockedByViewer()) return
      if (!findOwned(get().data, 'allocations', id)) return
      mutate((d) => ({ ...d, allocations: d.allocations.filter((a) => a.id !== id) }))
    },

    addTimeOff: (input) => {
      const accountId = requireAccount()
      const e: TimeOff = { ...input, id: newId(), accountId, ...stamp() }
      // Viewer no-op (P1.12 defense-in-depth): gate before the asserts; build the entity, skip persist.
      if (blockedByViewer()) return e
      assertResourceExists(get().data, accountId, input.resourceId)
      assertDateRange(input.startDate, input.endDate)
      mutate((d) => ({ ...d, timeOff: [...d.timeOff, e] }))
      return e
    },
    updateTimeOff: (id, patch) => {
      if (blockedByViewer()) return
      const existing = findOwned(get().data, 'timeOff', id)
      if (!existing) return
      // Always re-validate the EFFECTIVE MERGED resource (patch ?? existing), not just when the patch
      // touches resourceId. The server re-runs assertResourceExists on the full merged row on EVERY
      // write, so a type/date/note-only edit of time-off on a now-EXTERNAL resource (legacy data, or
      // after a resource kind-flip) would 400 on the server while succeeding here — diverging local and
      // synced state. Matching the merged-row check makes the store reject exactly what the server does.
      // It's a pure read — a date-only patch on a valid (non-external) resource still passes.
      assertResourceExists(get().data, existing.accountId, patch.resourceId ?? existing.resourceId, existing)
      assertDateRange(patch.startDate ?? existing.startDate, patch.endDate ?? existing.endDate)
      mutate((d) => ({ ...d, timeOff: updateById(d.timeOff, id, patch) }))
    },
    deleteTimeOff: (id) => {
      if (blockedByViewer()) return
      if (!findOwned(get().data, 'timeOff', id)) return
      mutate((d) => ({ ...d, timeOff: d.timeOff.filter((t) => t.id !== id) }))
    },

    // --- Data-lifecycle actions (P2.5b DEMO-build path). See the StoreState block above for the
    // shared contract. Active → Archived → Soft-deleted → Purged is the ONLY removal path for the three
    // tombstone-carrying tables (resources / clients / projects); there is no immediate hard-delete
    // action for them — a physical row removal happens only at the END of the lifecycle, in purgeEntity,
    // which composes the shared delete*Cascade so the tombstone AND its children go together (a
    // resource's allocations/time-off; a client's projects/activities/allocations; a project's
    // phases/activities/allocations). Single-sourced from shared/lib/integrity.ts so the purge cascade
    // can't drift from the cascade the other tables' delete* actions use.
    archiveEntity: (entity, id) => {
      if (blockedByViewer()) return
      if (!findOwned(get().data, entity, id)) return
      // Reject the built-in Internal client — a fixed bucket that may not be archived (mirrors the
      // builtin guard in updateClient/purgeEntity). Throw a display-safe message; the caller surfaces.
      if (entity === 'clients') {
        const existing = findOwned(get().data, 'clients', id)
        if (existing && isBuiltinClient(existing)) throw new Error('The Internal client is built in and cannot be archived.')
      }
      // archive() THROWS if the row isn't 'active' (defense-in-depth — the UI gates via canArchive
      // first). Surface-not-swallow: let it throw, exactly like the builtin guards above.
      mutate((d) => ({ ...d, [entity]: d[entity].map((e) => {
        if (e.id !== id) return e
        const now = touchAfter(e.updatedAt)
        return { ...archive(e, now), updatedAt: now }
      }) }))
    },
    unarchiveEntity: (entity, id) => {
      if (blockedByViewer()) return
      if (!findOwned(get().data, entity, id)) return
      // No builtin guard: the Internal client can never reach 'archived' (archiveEntity rejects it), so
      // unarchive() would throw 'not archived' anyway. unarchive() THROWS if the row isn't archived.
      mutate((d) => ({ ...d, [entity]: d[entity].map((e) => (e.id === id ? { ...unarchive(e), updatedAt: touchAfter(e.updatedAt) } : e)) }))
    },
    softDeleteEntity: (entity, id) => {
      if (blockedByViewer()) return
      if (!findOwned(get().data, entity, id)) return
      // The Internal client can never be 'archived' (so softDelete would throw), but guard explicitly
      // for a display-safe message and parity with the delete path.
      if (entity === 'clients') {
        const existing = findOwned(get().data, 'clients', id)
        if (existing && isBuiltinClient(existing)) throw new Error('The Internal client is built in and cannot be deleted.')
      }
      // softDelete() THROWS unless the row is 'archived' (prior-archival rule). For a resource, COMPOSE
      // the shared obfuscateResource so the local tombstone carries NO original PII (the obfuscation
      // string is single-sourced from lifecycle.ts — never hand-written here).
      mutateIrreversible((d) => ({
        ...d,
        [entity]: d[entity].map((e) => {
          if (e.id !== id) return e
          const now = touchAfter(e.updatedAt)
          const t = softDelete(e, now)
          return entity === 'resources'
            ? { ...obfuscateResource(t as Resource), updatedAt: now }
            : { ...t, updatedAt: now }
        }),
        ...(entity === 'resources'
          ? {
              allocations: d.allocations.map((a) => a.resourceId === id ? { ...a, note: undefined, updatedAt: touchAfter(a.updatedAt) } : a),
              timeOff: d.timeOff.map((t) => t.resourceId === id ? { ...t, note: undefined, updatedAt: touchAfter(t.updatedAt) } : t),
            }
          : {}),
      }))
    },
    purgeEntity: (entity, id) => {
      if (blockedByViewer()) return
      const existing = findOwned(get().data, entity, id)
      if (!existing) return
      // The built-in Internal client cannot be purged — every account must keep exactly one. Re-fetch
      // with the literal 'clients' key so the narrowed Client type satisfies isBuiltinClient (matches
      // archiveEntity/softDeleteEntity).
      if (entity === 'clients') {
        const client = findOwned(get().data, 'clients', id)
        if (client && isBuiltinClient(client)) throw new Error('The Internal client is built in and cannot be deleted.')
      }
      // Enforce the grace window: canPurge is false unless this is a soft-deleted tombstone aged at
      // least PURGE_MIN_AGE_DAYS. A refused purge is a gated affordance, NOT corruption — surface a
      // notice and no-op rather than throw (the throw idiom is reserved for tenancy/integrity bugs).
      // Exact-instant "now", not date-only midnight: a midnight-truncated timestamp would let
      // the client stay up to ~24h more conservative than the server's own boundary check.
      if (!canPurge(existing, new Date().toISOString())) {
        get().setNotice(m.notice_purge_grace_window({ days: PURGE_MIN_AGE_DAYS }), 'error')
        return
      }
      // Hard purge: physically remove the row AND cascade its children, via the SAME cascade the
      // regular delete* actions use (single-sourced from shared/lib/integrity.ts — no drift).
      mutateIrreversible((d) => {
        if (entity === 'resources') return deleteResourceCascade(d, id)
        const now = nextDataRevision(d)
        return entity === 'clients'
          ? deleteClientCascade(d, id, now)
          : deleteProjectCascade(d, id, now)
      })
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
      set((s) => {
        // The date picker now snaps to the week start so the grid's left edge always lands on a
        // week boundary (mirrors goToToday). The date input shows the snapped Monday, since it's
        // value={focusDate}.
        const account = s.activeAccountId ? s.data.accounts.find((a) => a.id === s.activeAccountId) : null
        const wso = account?.weekStartsOn ?? 1
        const weekStart = startOfWeekISO(date, wso)
        return {
          ui: {
            ...s.ui,
            originDate: addDaysISO(weekStart, -PAST_BUFFER_DAYS),
            focusDate: weekStart,
            recenterToken: s.ui.recenterToken + 1,
          },
        }
      }),
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
