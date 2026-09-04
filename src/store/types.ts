import type { WeeksZoom } from "../lib/schedulerConfig";
import type { BarLabelPrefs, UtilizationPrefs } from "../lib/displayPrefs";
import type { ThemePref } from "../lib/theme";
import type { Role } from "@capacitylens/shared/domain/access";
import type { MasqueradeState } from "@capacitylens/shared/domain/masquerade";
import type {
  Account,
  Activity,
  Allocation,
  AppData,
  Client,
  Closure,
  Discipline,
  Entity,
  ID,
  ISODate,
  Phase,
  Project,
  Resource,
  ResourceEngagement,
  ScopedEntityKey,
  TimeOff,
} from "@capacitylens/shared/types/entities";

export type MasqueradeRuntimeState =
  | { phase: "inactive" }
  | {
      phase: "starting";
      pending: { accountId: string; targetUserId: string };
      state?: MasqueradeState;
      generation: number;
    }
  | { phase: "active" | "ending"; state: MasqueradeState; generation: number };

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
type DraftFields<T extends Entity> = Omit<T, "id" | "accountId" | "createdAt" | "updatedAt" | "builtin">;
type ResourceDraft = Omit<DraftFields<Resource>, "engagement"> & {
  engagement?: ResourceEngagement;
};
export type Draft<T extends Entity> = T extends Resource ? ResourceDraft : DraftFields<T>;
export type Patch<T extends Entity> = Partial<Draft<T>>;

/** One row of a scoped table, and the patch shape accepted for it (server-owned fields excluded). */
export type ScopedRow<K extends ScopedEntityKey> = AppData[K][number];
export type ScopedPatch<K extends ScopedEntityKey> = Partial<Omit<ScopedRow<K>, keyof Entity>>;

// The three entity tables that carry the lifecycle tombstones (`archivedAt`/`deletedAt`, P2.1) and so
// can travel the Active → Archived → Soft-deleted → Purged machine (`shared/src/domain/lifecycle.ts`).
// MIRRORS the server's lifecycle-route entity union so the LOCAL store actions below and the server's
// dedicated routes (P2.5a) operate over the IDENTICAL set — phases/activities/allocations/timeOff/
// disciplines/accounts have no tombstone and are deliberately excluded.
export type LifecycleEntity = "resources" | "clients" | "projects";

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
  message: string;
  tone: "info" | "warning" | "error";
}

/**
 * The minimal per-login account summary that drives the AccountPicker (P1.13) — the server-sourced
 * list of accounts this login may open. Mirrors the provider-neutral workspace summary returned by
 * `GET /api/accounts`; the browser alias stays product-named and server modules remain outside the
 * client build.
 *
 * This is kept SEPARATE from `data.accounts`: in server mode `data` holds only the ACTIVE account's
 * slice (one account), so the picker — which must list ALL the login's tenants — reads `accountSummaries`
 * instead. In the demo build the two are kept in lockstep (summaries derived from `data.accounts`).
 *
 * @property id    The `accountId` a subsequent `GET /api/state?accountId=…` hydrates.
 * @property name  The company name shown in the picker.
 * @property role  The caller's role for this account (OFF/demo supply 'owner' = full access).
 * @property roleStatus Whether the server supplied a trustworthy role. An unavailable role keeps
 *   the account selectable but must never be presented as the fail-closed Viewer projection.
 */
export interface AccountSummary {
  id: ID;
  name: string;
  role: Role;
  roleStatus?: "resolved" | "unavailable";
}

/** Outcome of an import: how many records landed vs. were dropped as invalid
 *  (broken date range / dangling ref). Lets the UI report the delta honestly. */
export interface ImportSummary {
  imported: number;
  skipped: number;
}

// Re-exported for convenience.
export type { WeeksZoom };

export interface Filters {
  disciplineId: ID | null;
  clientId: ID | null;
  projectId: ID | null;
  /** Activity lens: a specific internal/all-projects activity. Mutually exclusive with the
   *  client/project lens and with `activityKind` (enforced in setFilters). */
  activityId: ID | null;
  /** Activity lens: ALL activities of a kind ('Internal — All' / 'All projects — All'). Mutually
   *  exclusive with the client/project lens and with `activityId`. */
  activityKind: "internal" | "repeatable" | null;
  search: string;
  hideTentative: boolean;
  /** When a client/project/activity filter is active, ALSO show resources with no work on it
   *  (dimmed) so you can see who's free to staff. Off (the default) = filtering
   *  hides them, leaving only the matching resources' rows. */
  showUnmatched: boolean;
}

export const emptyFilters = (): Filters => ({
  disciplineId: null,
  clientId: null,
  projectId: null,
  activityId: null,
  activityKind: null,
  search: "",
  hideTentative: false,
  showUnmatched: false,
});

/** Drop the ENTITY lenses (discipline / client / project / activity) while leaving the text search
 *  and the tentative/unmatched view preferences exactly as the user set them. Used where new data
 *  arrives under the same tenant and the old lens ids no longer resolve. */
export const clearEntityLenses = (filters: Filters): Filters => ({
  ...filters,
  disciplineId: null,
  clientId: null,
  projectId: null,
  activityId: null,
  activityKind: null,
});

/** The project/client lens specifically — the pair that decides whether a bar "matches the filter"
 *  (the activity lens is standalone and mutually exclusive with it via setFilters). */
export function hasProjectClientLens(f: Filters): boolean {
  return !!(f.projectId || f.clientId);
}

/** Any "what work" lens is active — project/client OR activity. This is the gate for the dimmed
 *  show-unmatched staffing view, which behaves identically whichever of the two lenses is set. */
export function hasLensFilter(f: Filters): boolean {
  return hasProjectClientLens(f) || !!(f.activityId || f.activityKind);
}

export function hasActiveFilters(f: Filters): boolean {
  return hasLensFilter(f) || !!f.disciplineId || f.search.trim() !== "" || f.hideTentative;
}

/** What a draw-on-a-lane gesture creates. */
export type DrawMode = "work" | "timeoff";

export interface SchedulerUI {
  zoom: WeeksZoom; // number of weeks visible; day-column width is derived from it
  originDate: ISODate;
  rangeDays: number;
  focusDate: ISODate; // the date the grid scrolls to when recenterToken bumps
  drawMode: DrawMode; // draw-to-create makes an allocation ('work') or time off
  selectedAllocationId: ID | null;
  filters: Filters;
  collapsedGroups: string[]; // discipline group keys that are collapsed
  recenterToken: number; // bumped to ask the grid to scroll focusDate back into view
  /** Transient resource-row jump. Each request starts unconsumed; SchedulerGrid consumes it only
   *  after finding and scrolling the row, so a temporarily hidden row can retry without replaying
   *  after success. Token-per-request supports repeated jumps to the same id. Never persisted or
   *  placed on the undo stack. */
  scrollToResource: { id: ID; token: number; consumed: boolean } | null;
}

export interface StoreState {
  data: AppData;
  ui: SchedulerUI;
  hydrated: boolean;
  /** The tenant currently in view. Null = no account chosen (show the picker). Never persisted. */
  activeAccountId: ID | null;
  /** The account that was active before switching to the picker — lets the picker
   *  offer a "back" escape after an accidental "Switch company". Never persisted. */
  previousAccountId: ID | null;
  /** The server-sourced list of accounts this login may open (P1.13) — the AccountPicker's data
   *  source. Set by useAccountSummaries: in server mode from `GET /api/accounts` (the login's
   *  memberships); in the demo build derived from `data.accounts`. SEPARATE from `data` because in
   *  server mode `data` holds only the ACTIVE account's slice, so it can't list the other tenants.
   *  Never persisted. */
  accountSummaries: AccountSummary[];
  /** Whether the published directory was wholly valid. A partial response may populate the picker,
   *  but cannot prove that exactly one company exists. Transient and never persisted. */
  accountSummariesComplete: boolean;
  /** Latest issued server-directory read. Direct list mutations advance this too, so an older
   *  response cannot overwrite a create/delete/join result. Transient and never persisted. */
  accountSummariesRequestId: number;
  past: AppData[];
  future: AppData[];
  persistError: boolean;
  /** True when stored data existed but could not be read (corrupt JSON / failed
   *  migrate). Distinct from persistError (a WRITE failure): on a load error the
   *  app renders empty and autosave is intentionally NOT attached, so a recovery
   *  UI can offer reset/import/export without overwriting the unreadable bytes. */
  loadError: boolean;
  /** True when a REMOTE load failed (server down / network error) — distinct from
   *  loadError (corrupt LOCAL bytes). The app renders empty with no autosave attached,
   *  and a connection-error screen offers a retry. Clearing local storage (the
   *  StorageRecovery path) can't recover a server-backed app, so the two are kept apart. */
  connectionError: boolean;
  /** User message (e.g. a rejected drag, or a clamp advisory) + its severity, as ONE value so the
   *  two can't desync. 'info' auto-dismisses (~4s); 'warning' and 'error' persist until dismissed —
   *  'warning' for a data-mutating advisory the user must notice (a fixed short timer on it fails
   *  WCAG 2.2.1), 'error' for a failure (an error that vanishes before it's read is useless). See
   *  {@link Notice}. Null = no notice. */
  notice: Notice | null;
  /** Latest screen-reader capacity announcement (WCAG 4.1.3) + a monotonically-rising `seq`.
   *  A keyboard-committed allocation edit (move/resize) recomputes over-capacity, which mutates the
   *  silent per-row sr-only summary while focus stays on the bar — leaving a screen-reader user with
   *  NO feedback that their own edit flipped a day to over. AllocationBar fires `announceCapacity`
   *  AFTER such an edit; SchedulerGrid renders ONE polite aria-live region from this. The `seq`
   *  guarantees re-announcement even when consecutive edits yield the SAME text (an aria-live region
   *  re-reads only on a content change). Transient: never persisted, never on the undo stack. POINTER
   *  drags do NOT set this — they give sighted feedback and would be noise for everyone. Null = none yet. */
  srAnnouncement: { text: string; seq: number } | null;
  /** True while any registered form/operation has unsaved work — drives the unsaved-changes guards
   *  (modal backdrop/Escape, beforeunload). Derived from source ownership, never persisted. */
  dirtyForm: boolean;
  /** Internal owner set from which dirtyForm is derived. Transient and never persisted. */
  dirtyFormSources: ReadonlySet<symbol>;
  /** The allocation currently being dragged/resized, or null. Transient UI (like
   *  dirtyForm) — never persisted, never on the undo stack. Lets the scheduler PIN the
   *  dragged row so a mid-gesture vertical scroll can't virtualise it out and orphan the
   *  drag (the document pointer listeners would be torn down on unmount). */
  draggingAllocationId: ID | null;
  /** Colour-scheme preference. Device-global, not part of account data: kept in the
   *  store only for reactivity, persisted to its own localStorage key by setTheme. */
  theme: ThemePref;
  /** Utilisation display toggles. Device-global like `theme`, persisted to their
   *  own localStorage key — not part of account data. */
  utilizationPrefs: UtilizationPrefs;
  /** Allocation-bar label toggles (client/project context before the activity name).
   *  Device-global like `utilizationPrefs`, own localStorage key. */
  barLabelPrefs: BarLabelPrefs;
  /** Sidebar open (labels) vs collapsed (icon rail). Device-global like `theme`,
   *  own localStorage key; the first-run default is viewport-derived (collapsed
   *  on small screens, open on desktop). */
  sidebarOpen: boolean;
  /** Shrink the weekend (Sat/Sun) columns on the schedule to a sliver. Device-global like
   *  `theme`, own localStorage key, NOT in AppData/export — and defaults ON. */
  minimiseWeekends: boolean;
  /** After a FREE horizontal scroll settles, floor the grid's left edge to the current week's
   *  first day. Device-global like `theme` (own localStorage key, NOT in AppData/export), defaults
   *  ON. Governs FREE SCROLL ONLY — the navigation snap (zoom / Prev-Next / date-picker) is always
   *  on, independent of this flag. */
  snapToWeekStart: boolean;
  /** Schedule vertical density. Device-global like `theme` (own localStorage key, NOT in
   *  AppData/export) and defaults OFF, which is the ROOMIER layout — off is what the product
   *  ships, and ON restores the tighter original spacing for people who want more rows on
   *  screen. Selects the geometry in `components/scheduler/layout.ts` (`schedulerDensity`). */
  compactView: boolean;
  /** COSMETIC demo "fake sign-in" state — gates a Google-style demo sign-in screen BEFORE
   *  the account picker so a viewer sees "log in first, then pick a company". Device-global
   *  like `theme` (own localStorage key, NOT in AppData/export), defaults OFF (signed out).
   *  NOT real auth — the real seam is `src/auth/`; the gate is active only when that auth is
   *  off. See `src/components/FakeSignIn.tsx`. */
  fakeSignedIn: boolean;
  /** Whether the post-login "What CapacityLens is" intro page has been dismissed on this device.
   *  Device-global like `theme` (own localStorage key, NOT in AppData/export), defaults OFF so
   *  the intro shows once on first contact (after a company is chosen), then stays dismissed.
   *  Frequency is once per device by design (DECISIONS.md). See `src/components/IntroPage.tsx`. */
  introSeen: boolean;
  /** Whether the schedule's first-run "Getting started" checklist card has been dismissed on this
   *  device. Device-global like `theme` (own localStorage key, NOT in AppData/export), defaults OFF
   *  so the checklist shows on first contact. The card also self-hides once every step is complete
   *  (derived live from scoped data) — this flag records only an explicit dismissal.
   *  See `src/components/GettingStarted.tsx`. */
  gettingStartedDismissed: boolean;
  /** The caller's resolved {@link Role} for the ACTIVE account, or null. Set by PermissionProvider
   *  (P1.12) once it resolves the role from `GET /api/accounts`; null in OFF/local/not-fetched.
   *  Transient (never persisted, never on the undo stack). It powers ONLY the defense-in-depth
   *  mutation guard below (assertCanWrite): a scoped mutation NO-OPS when this is exactly 'viewer',
   *  so an ungated affordance or an optimistic write that the server would 403 can't desync local
   *  state. The server 403 (P1.5) is the TRUE security backstop — this is UX/defense-in-depth, NOT
   *  the access boundary, which is why ANY non-'viewer' value (incl. null = OFF/local) stays editable. */
  activeRole: Role | null;
  /** Why a fail-closed Viewer projection is active. Keeps mutation notices factual while role
   * resolution is pending/unavailable; transient and never persisted. */
  activeRoleStatus: "not-applicable" | "pending" | "resolved" | "unavailable";
  /** Monotonic invalidation token for server-owned membership state. Member mutations bump it so
   *  the current directory-request owner re-reads the caller's effective role/list without an
   *  account switch or page reload. Transient: never persisted or included in undo history. */
  membershipRevision: number;
  /** Session-backed read projection. Every non-inactive phase blocks local writes while the
   * controller establishes or removes the authoritative server projection. */
  masquerade: MasqueradeRuntimeState;

  addAccount: (input: Draft<Account>) => Account | null;
  updateAccount: (id: ID, patch: Patch<Account>) => void;
  deleteAccount: (id: ID) => void;
  setActiveAccount: (id: ID | null) => void;
  /** Start one server-directory read and return its monotonic identity. */
  beginAccountSummariesRequest: () => number;
  /** Replace the picker list. A request-bound result applies only while it is still the latest;
   *  an unbound direct mutation invalidates every in-flight request. Returns whether it applied. */
  setAccountSummaries: (list: AccountSummary[], requestId?: number, complete?: boolean) => boolean;

  replaceAll: (data: AppData) => void;
  /** Replace the active account's slice from an import; undoable via ⌘Z. Returns a
   *  summary of how many records were brought in vs. dropped as invalid. */
  importData: (data: AppData) => ImportSummary;
  setHydrated: (v: boolean) => void;
  setPersistError: (v: boolean) => void;
  setLoadError: (v: boolean) => void;
  setConnectionError: (v: boolean) => void;
  setNotice: (message: string | null, tone?: "info" | "warning" | "error") => void;
  /** Announce a capacity outcome to the grid's polite aria-live region (WCAG 4.1.3). Bumps `seq`
   *  so the SAME text re-announces (an aria-live region re-reads only on a content change). Call
   *  ONLY after a successful KEYBOARD-committed allocation edit — pointer drags give sighted
   *  feedback and must not announce. Transient, never persisted/undone. */
  announceCapacity: (text: string) => void;
  setDirtyForm: (v: boolean) => void;
  /** Publish or clear one component's dirty contribution without disturbing another owner. */
  setDirtyFormSource: (source: symbol, dirty: boolean) => void;
  /** Mark/clear the allocation being dragged (drives the grid's drag-pin). */
  setDraggingAllocation: (id: ID | null) => void;
  /** Set the colour-scheme preference: persist it, repaint the DOM, update state. */
  setTheme: (pref: ThemePref) => void;
  /** Toggle a single utilisation display preference: persist and update state. */
  setUtilizationPref: (key: keyof UtilizationPrefs, value: boolean) => void;
  /** Toggle a single bar-label display preference: persist and update state. */
  setBarLabelPref: (key: keyof BarLabelPrefs, value: boolean) => void;
  /** Open/collapse the sidebar: persist the choice and update state. */
  setSidebarOpen: (open: boolean) => void;
  /** Toggle the minimise-weekends preference: persist and update state. */
  setMinimiseWeekends: (value: boolean) => void;
  /** Toggle the snap-to-week-start preference: persist and update state. */
  setSnapToWeekStart: (value: boolean) => void;
  setCompactView: (value: boolean) => void;
  /** Set the cosmetic fake-sign-in state: persist and update state. */
  setFakeSignedIn: (value: boolean) => void;
  /** Mark the post-login intro page as seen on this device: persist and update state. */
  setIntroSeen: (value: boolean) => void;
  /** Mark the "Getting started" checklist as dismissed on this device: persist and update state. */
  setGettingStartedDismissed: (value: boolean) => void;
  /** Set the active account's resolved role (P1.12) — called by PermissionProvider whenever it
   *  resolves/changes the role (incl. back to null on OFF/local/account-switch). Plain transient
   *  state: never persisted, never on the undo stack. Drives ONLY the defense-in-depth write guard. */
  setActiveRole: (role: Role | null, status?: "not-applicable" | "pending" | "resolved" | "unavailable") => void;
  /** Invalidate all client projections derived from account membership. */
  invalidateMemberships: () => void;
  setMasquerade: (state: MasqueradeRuntimeState) => void;
  clearUndoHistory: () => void;
  /** Sign out of the cosmetic demo: drop the active company AND the "back" breadcrumb, then
   *  clear the device-global flag so the demo sign-in shows again. Cosmetic only — never
   *  touches the real auth seam (`src/auth/`); both call sites are guarded by `authMode === 'off'`. */
  signOutDemo: () => void;
  undo: () => void;
  redo: () => void;

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
  addDiscipline: (input: Draft<Discipline>) => Discipline;
  updateDiscipline: (id: ID, patch: Patch<Discipline>) => void;
  deleteDiscipline: (id: ID) => void;

  addResource: (input: Draft<Resource>) => Resource;
  updateResource: (id: ID, patch: Patch<Resource>) => void;

  addClient: (input: Draft<Client>) => Client;
  updateClient: (id: ID, patch: Patch<Client>) => void;

  addProject: (input: Draft<Project>) => Project;
  updateProject: (id: ID, patch: Patch<Project>) => void;

  addPhase: (input: Draft<Phase>) => Phase;
  updatePhase: (id: ID, patch: Patch<Phase>) => void;
  deletePhase: (id: ID) => void;

  addActivity: (input: Draft<Activity>) => Activity;
  updateActivity: (id: ID, patch: Patch<Activity>) => void;
  deleteActivity: (id: ID) => void;

  /** Create one allocation through the same atomic validation/write path as `addAllocations`. */
  addAllocation: (input: Draft<Allocation>) => Allocation;
  /** Create a non-empty allocation batch in one mutation/history step. Every draft is validated before
   * anything commits; a tenancy, reference or date-range failure throws and leaves state untouched. */
  addAllocations: (inputs: readonly Draft<Allocation>[]) => Allocation[];
  /** Apply an allocation patch. False means the write was deliberately refused as a Viewer or the
   * target disappeared before commit; validation/tenancy violations still throw. */
  updateAllocation: (id: ID, patch: Patch<Allocation>) => boolean;
  deleteAllocation: (id: ID) => void;
  /** Atomically delete one linked occurrence and every same-series occurrence starting on/after it. */
  deleteAllocationSeriesFrom: (id: ID) => void;

  addTimeOff: (input: Draft<TimeOff>) => TimeOff;
  updateTimeOff: (id: ID, patch: Patch<TimeOff>) => void;
  deleteTimeOff: (id: ID) => void;

  addClosure: (input: Draft<Closure>) => Closure;
  updateClosure: (id: ID, patch: Patch<Closure>) => void;
  deleteClosure: (id: ID) => void;

  // --- Data-lifecycle (P2.5b): the Active → Archived → Soft-deleted → Purged machine for the three
  // tombstone-carrying tables (resources / clients / projects). These are the DEMO-build / OFF path —
  // they mutate the local `data` blob through the same mutate()/undo machinery as the CRUD above. In
  // SERVER mode the UI instead calls the dedicated routes (POST /api/:entity/:id/{archive,unarchive,
  // delete,purge}, P2.5a) directly, so the admin view only invokes these in the demo build. They COMPOSE
  // the pure shared lifecycle helpers (shared/src/domain/lifecycle.ts) — the transition logic and the
  // soft-delete obfuscation string are NEVER re-derived here. Archive/unarchive are undoable;
  // soft-delete/purge clear both history stacks so erased data cannot be recovered from memory.
  // All four are viewer-no-op and stale-id-no-op, and invalid transitions throw a display-safe Error
  // (the UI gates with the can* predicates first; the throw is the defense-in-depth backstop).
  /** Archive an entity (active → archived). DEMO-build path; surface-not-swallow — `archive` throws
   *  if the row isn't active. @param entity which tombstone table. @param id the row to archive. */
  archiveEntity: (entity: LifecycleEntity, id: ID) => void;
  /** Un-archive an entity (archived → active). DEMO-build path; `unarchive` throws if the row isn't
   *  archived. @param entity which tombstone table. @param id the row to restore. */
  unarchiveEntity: (entity: LifecycleEntity, id: ID) => void;
  /** Soft-delete an entity (archived → deleted tombstone). DEMO-build path; `softDelete` throws unless
   *  the row is archived first (the lifecycle requires prior archival). For a `resources` row the
   *  tombstone's `name` is ALSO scrubbed via the shared `obfuscateResource` — the local copy retains
   *  no original PII while it awaits purge. @param entity which tombstone table. @param id the row. */
  softDeleteEntity: (entity: LifecycleEntity, id: ID) => void;
  /** Hard-purge a soft-deleted tombstone (physically remove + cascade its children). DEMO-build path.
   *  Enforces the {@link PURGE_MIN_AGE_DAYS} grace window via `canPurge`: if the tombstone is too young
   *  it does NOT mutate and surfaces an error notice instead of throwing (a refused affordance, not a
   *  bug). @param entity which tombstone table. @param id the tombstone to purge. */
  purgeEntity: (entity: LifecycleEntity, id: ID) => void;

  setZoom: (zoom: WeeksZoom) => void;
  setOriginDate: (date: ISODate) => void;
  panDays: (delta: number) => void;
  goToToday: () => void;
  goToDate: (date: ISODate) => void;
  setDrawMode: (mode: DrawMode) => void;
  selectAllocation: (id: ID | null) => void;
  setFilters: (patch: Partial<Filters>) => void;
  clearFilters: () => void;
  toggleGroup: (key: string) => void;
  /** Clear schedule filters (so the resource row is visible) then set
   *  scrollToResource — SchedulerGrid watches this to scroll the row into view.
   *  Transient UI: NOT persisted, NOT on the undo stack. */
  jumpToResource: (id: ID) => void;
  /** Mark one exact resource-jump token consumed after its row was scrolled into view. A stale
   *  acknowledgement never consumes a newer request. */
  consumeResourceJump: (token: number) => void;
}
