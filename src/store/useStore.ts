import { create } from "zustand";
import { newId } from "@capacitylens/shared/lib/id";
import { type WeeksZoom } from "../lib/schedulerConfig";
import {
  allocationAttributionAllowed,
  withoutAllocationAttribution,
  deleteClientCascade,
  deleteDisciplineCascade,
  deletePhaseCascade,
  deleteProjectCascade,
  deleteResourceCascade,
  deleteActivityCascade,
} from "@capacitylens/shared/lib/integrity";
import {
  assertActivityProjectAllowsDependents,
  assertAllocationRefs,
  assertDateRange,
  assertResourceExists,
  assertResourceKindAllowsDependents,
  assertResourceProjectAllowsDependents,
  assertScopedRefs,
  deleteAccountCascade,
  findOwned as findOwnedIn,
  remapAndValidateImport,
} from "@capacitylens/shared/domain/mutations";
import {
  archive,
  canPurge,
  obfuscateResource,
  PURGE_MIN_AGE_DAYS,
  softDelete,
  unarchive,
} from "@capacitylens/shared/domain/lifecycle";
import { m } from "@/i18n";
import { type BarLabelPrefs, type UtilizationPrefs } from "../lib/displayPrefs";
import type { ThemePref } from "../lib/theme";
import type { Role } from "@capacitylens/shared/domain/access";
import { buildInternalClient, isBuiltinClient } from "@capacitylens/shared/data/internalClient";
import { hasUsablePrivateCodeName } from "@capacitylens/shared/domain/privateNames";
import type { AppDataKey } from "@capacitylens/shared/types/entities";
import {
  APP_DATA_KEYS,
  clampHoursPerDay,
  clampWorkingHoursPerDay,
  emptyAppData,
  isPlaceholderResource,
  placeholderCapacityDefaults,
} from "@capacitylens/shared/types/entities";
import { NEUTRAL_COLOR, snapToPresetColor } from "@capacitylens/shared/lib/color";
import type {
  Account,
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
  Activity,
  TimeOff,
  Weekday,
} from "@capacitylens/shared/types/entities";
import { createRuntimeSlice } from "./slices/runtimeSlice";
import { createSchedulerSlice, weekAnchor } from "./slices/schedulerSlice";
import { isWeekdaySet, normalizeAccountWorkingDays } from "@capacitylens/shared/lib/accountWorkingDays";
import { domainError } from "@capacitylens/shared/domain/errors";

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
type ScopedRow<K extends ScopedEntityKey> = AppData[K][number];
type ScopedPatch<K extends ScopedEntityKey> = Partial<Omit<ScopedRow<K>, keyof Entity>>;

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

const stamp = () => {
  const now = new Date().toISOString();
  return { createdAt: now, updatedAt: now };
};
const touch = () => new Date().toISOString();
const MAX_DATE_MS = 8_640_000_000_000_000;
// Take an ARRAY, not rest args: the whole-tenant callers (nextDataRevision, prepareHistoryTarget)
// pass one timestamp per row, and spreading tens of thousands of rows as function arguments can
// overflow the engine's argument limit (RangeError), failing an undo/redo or cascade-delete
// outright. Iterating an array is unbounded-safe. `touchAfter` keeps the ergonomic variadic shape
// for the many few-arg callers by delegating here.
const advancePast = (value: string | undefined, next: number): number => {
  if (!value) return next;
  const parsed = Date.parse(value);
  // The maximum representable Date is valid ISO input but has no representable successor. Refuse
  // the write explicitly; publishing Date.now() here would silently move its revision backwards.
  if (parsed === MAX_DATE_MS) {
    throw new Error("Cannot update data whose revision has no representable successor.");
  }
  return Number.isFinite(parsed) && parsed >= next ? parsed + 1 : next;
};
const touchAfterAll = (timestamps: Array<string | undefined>): string => {
  let next = Date.now();
  for (const value of timestamps) next = advancePast(value, next);
  return new Date(next).toISOString();
};
const touchAfter = (...timestamps: Array<string | undefined>): string => touchAfterAll(timestamps);
// Fold a WHOLE tenant's revisions into the running maximum in ONE pass. Materialising the
// timestamps first would allocate an array per table (tens of thousands of strings on a large
// account) for a value only ever reduced to a single number.
const advanceOverData = (data: AppData, next: number): number => {
  let result = next;
  for (const rows of Object.values(data) as Entity[][]) {
    for (const row of rows) result = advancePast(row.updatedAt, result);
  }
  return result;
};
const nextDataRevision = (data: AppData): string => new Date(advanceOverData(data, Date.now())).toISOString();

/**
 * Undo/redo restores historical values, but `updatedAt` is a synchronization revision rather than
 * user history. Re-stamp every surviving row whose content changes across the history transition;
 * otherwise the diff engine either misses a restored FK or the server rejects the old timestamp as
 * stale. Rows recreated from deletion need no stamp because the server has no current row to beat.
 */
function prepareHistoryTarget(current: AppData, target: AppData): AppData {
  const now = new Date(advanceOverData(target, advanceOverData(current, Date.now()))).toISOString();
  const retime = <T extends Entity>(beforeRows: T[], targetRows: T[]): T[] => {
    // Immutable mutations structurally share every untouched table. Preserve that array wholesale;
    // even within a changed table, untouched rows retain object identity and need no serialization.
    if (beforeRows === targetRows) return targetRows;
    const beforeById = new Map(beforeRows.map((row) => [row.id, row]));
    const content = (row: T): string => JSON.stringify({ ...row, updatedAt: undefined });
    return targetRows.map((row) => {
      const before = beforeById.get(row.id);
      if (before === row) return row;
      return before && (before.updatedAt !== row.updatedAt || content(before) !== content(row))
        ? { ...row, updatedAt: now }
        : row;
    });
  };
  // Driven by the shared key list (same altitude as hasSameEntityRevisions below) so a new AppData
  // table can't be silently dropped from the history transition by a missed hand-written line. The
  // row type is erased to Entity here; each table's real type is restored by the AppData return.
  const next = emptyAppData() as Record<AppDataKey, Entity[]>;
  for (const key of APP_DATA_KEYS) {
    next[key] = retime(current[key] as Entity[], target[key] as Entity[]);
  }
  return next as AppData;
}

/** True when a server refresh republishes the same authoritative entity revisions. */
function hasSameEntityRevisions(current: AppData, replacement: AppData): boolean {
  for (const key of Object.keys(current) as Array<keyof AppData>) {
    const currentRows = current[key];
    const replacementRows = replacement[key];
    if (currentRows.length !== replacementRows.length) return false;
    const replacementRevisions = new Map(replacementRows.map((row) => [row.id, row.updatedAt]));
    if (currentRows.some((row) => replacementRevisions.get(row.id) !== row.updatedAt)) {
      return false;
    }
  }
  return true;
}

const HISTORY_LIMIT = 50;

/** How each tombstone table is physically removed at the END of the lifecycle (purgeEntity): the
 *  row AND its children go together, via the SAME cascades the regular delete* actions use
 *  (single-sourced from shared/lib/integrity.ts — no drift). The resource cascade re-stamps
 *  nothing, so it alone needs no fresh revision. */
const PURGE_CASCADES: Record<LifecycleEntity, (data: AppData, id: ID) => AppData> = {
  resources: (data, id) => deleteResourceCascade(data, id),
  clients: (data, id) => deleteClientCascade(data, id, nextDataRevision(data)),
  projects: (data, id) => deleteProjectCascade(data, id, nextDataRevision(data)),
};

// --- Tenant-boundary resets ----------------------------------------------------------------------
// Deleting, switching, publishing a slice without the active tenant, or importing over one all cross
// a tenant boundary, and none of them may carry the LEAVING account's transient session state or
// scheduler view into what is shown next. The field sets live here ONCE so a boundary can't quietly
// forget one; each site keeps only what is specific to it (which notice, whether the week is
// re-anchored, which filters survive).

/** Every transient, tenant-owned session field, cleared. `notice` is deliberately NOT included:
 *  each boundary has its own message (or none). */
const clearedSession = () => ({
  srAnnouncement: null,
  dirtyForm: false,
  dirtyFormSources: new Set<symbol>(),
  draggingAllocationId: null,
});

/** The scheduler view blanked for the incoming tenant. Pass an `anchor` ({@link weekAnchor}) to ALSO
 *  open on that account's current week; omit it where the week in view must be preserved. */
const resetSchedulerView = (ui: SchedulerUI, anchor?: { originDate: ISODate; focusDate: ISODate }): SchedulerUI => ({
  ...ui,
  filters: emptyFilters(),
  collapsedGroups: [],
  selectedAllocationId: null,
  scrollToResource: null,
  ...anchor,
});

export const useStore = create<StoreState>()((set, get, store) => {
  // Every data mutation goes through mutate(): it snapshots the previous data
  // onto the undo stack and clears the redo stack.
  //
  // DO NOT wrap mutate(), its producers, undo/redo, the assert* helpers, or importData in a
  // try/catch to "be safe". Their integrity throws are the store's whole point — the last line that
  // stops bad multi-tenant data being persisted. Swallowing here would convert a loud, fixable
  // rejection into SILENT data corruption (the explicit anti-goal; see DEFENSIVE-CODING.md §4). If
  // a producer throws, `set` never runs, so state is left untouched — a clean, atomic failure.
  const mutate = (producer: (d: AppData) => AppData) =>
    set((s) => ({
      data: producer(s.data),
      past: [...s.past, s.data].slice(-HISTORY_LIMIT),
      future: [],
    }));

  // Erasure/purge actions must not leave a recoverable pre-erasure snapshot in memory. They also
  // cannot honestly be undoable, so clear both history directions as part of the same state write.
  const mutateIrreversible = (producer: (d: AppData) => AppData) =>
    set((s) => ({ data: producer(s.data), past: [], future: [] }));

  const applyPatch = <T extends Entity>(row: T, patch: Partial<Omit<T, keyof Entity>>): T => {
    const next = { ...row, ...patch } as T;
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete (next as Record<string, unknown>)[key];
    }
    return next;
  };
  const updateById = <T extends Entity>(list: T[], id: ID, patch: Partial<Omit<T, keyof Entity>>): T[] =>
    list.map((row) => (row.id === id ? { ...applyPatch(row, patch), updatedAt: touchAfter(row.updatedAt) } : row));

  // Every scoped add* stamps the active account. A non-null selection alone is insufficient. The
  // account must either exist in the published data or in the server-authorised summaries while a
  // switch is loading its slice (mid-switch edits are deliberately rebased by persist.ts). An id in
  // neither source is dead, so fail loudly rather than stamp an orphan accountId into the slice.
  const requireAccount = (): ID => {
    const state = get();
    const id = state.activeAccountId;
    if (!id) throw new Error("No active account — cannot mutate scoped data.");
    if (
      !state.data.accounts.some((account) => account.id === id) &&
      !state.accountSummaries.some((account) => account.id === id)
    ) {
      throw new Error("The active account is not loaded — cannot mutate scoped data.");
    }
    return id;
  };

  // Defense-in-depth viewer guard (P1.12). It is INERT unless the active role is EXACTLY 'viewer':
  // every other value — null (OFF/local/not-fetched), 'owner', 'admin', 'editor' — permits, so the
  // default deploy is byte-identical to today (fully editable). When the role IS 'viewer', a scoped
  // mutation NO-OPS (the caller returns early) and surfaces a notice, so an ungated affordance or an
  // optimistic local write the server would 403 can't desync local state. This is UX/defense-in-depth,
  // NOT the security boundary — the server 403 (P1.5) is the true backstop; we never throw here (a
  // throw would read as corruption and could crash a drag handler), we just refuse + inform.
  const blockedByViewer = (): boolean => {
    const state = get();
    if (state.activeRole !== "viewer") return false;
    const message =
      state.activeRoleStatus === "pending"
        ? m.access_checking_summary()
        : state.activeRoleStatus === "unavailable"
          ? m.access_unavailable_summary()
          : m.notice_viewer_read_only();
    state.setNotice(message, "error");
    return true;
  };

  // Tenancy + integrity rules now live in src/domain/mutations.ts (pure, shared
  // with a future server). findOwned is wrapped here to inject the active account
  // so the call sites stay terse; assertAllocation keeps its legacy name locally.
  // assertScopedRefs / assertDateRange / assertResourceExists are used directly
  // from the import above.
  const findOwned = <K extends ScopedEntityKey>(d: AppData, key: K, id: ID): AppData[K][number] | null =>
    findOwnedIn(d, requireAccount(), key, id);
  const assertAllocation = assertAllocationRefs;

  // The built-in "Internal" client is a FIXED bucket — every account must keep exactly one — so it
  // may be neither renamed nor moved through the lifecycle. One guard for all four rejecting
  // actions, each supplying the verb its message ends with. A non-client entity, a stale id and an
  // ordinary client all pass. Throws a display-safe message: surface, don't swallow (the callers
  // catch and show it; the UI also hides the affordance). See shared/src/data/internalClient.ts.
  const assertNotBuiltinClient = (entity: ScopedEntityKey, id: ID, verb: "renamed" | "archived" | "deleted"): void => {
    if (entity !== "clients") return;
    const client = findOwned(get().data, "clients", id);
    if (client && isBuiltinClient(client)) {
      throw new Error(`The Internal client is built in and cannot be ${verb}.`);
    }
  };

  // Value-level integrity backstop: a resource with zero working days has no capacity
  // any day. The form guards this, but the store is the last line so no path can persist
  // it. (The import path instead REPAIRS an empty set to Mon–Fri — see sanitizeImport.)
  // The three guards share ONE shape rule — a distinct set of in-week weekday numbers, from the
  // shared isWeekdaySet — and now enforce the SAME policy for resources and companies: at least
  // one working day, because company days govern capacity and an empty company week would zero
  // every person. A half day must additionally be a working day.
  const assertWorkingDays = (days: Weekday[]): void => {
    if (!isWeekdaySet(days) || days.length === 0) {
      throw new Error("At least one working day is required, using unique whole-number weekdays from 0 to 6.");
    }
  };
  const assertHalfDays = (halfDays: Weekday[], workingDays: Weekday[]): void => {
    if (!isWeekdaySet(halfDays) || halfDays.some((day) => !workingDays.includes(day))) {
      throw new Error("Half days must be unique whole-number weekdays contained in the working week.");
    }
  };
  // Write-time colour guard: snaps a bad/legacy colour to its NEAREST palette preset via the
  // shared snapToPresetColor mapper — the SAME mapper the server's sanitizeWrite('accounts') and
  // the one-time snap-legacy-account-colors migration use, so client and server can never
  // disagree about what a given colour snaps to (see DECISIONS.md). `allowNeutral` preserves the
  // ONE deliberate exception: NEUTRAL_COLOR is not itself a preset (see shared/lib/color.ts), but
  // an external resource's grey must round-trip unchanged rather than snap to its nearest preset.
  //
  // Deliberately called ONLY on a path that is actually about to persist (immediately before
  // mutate()/updateById below) — never before a reject check (blockedByViewer / a stale-id no-op /
  // an assert* throw). A rejected write must not silently substitute a colour the caller never
  // asked for onto an entity that was never saved; see the CRUD contract note on StoreState.
  const snapColor = (color: unknown, allowNeutral = false): string =>
    allowNeutral && color === NEUTRAL_COLOR ? (color as string) : snapToPresetColor(color);

  // Collapses the `patch.color === undefined ? patch : { ...patch, color: snapColor(...) }`
  // idiom that used to be copy-pasted across every update* action (P#: colour-repair
  // consolidation). Returns the SAME object reference when there's no colour to repair, so a
  // colourless edit doesn't pay for a needless clone.
  const withSnappedColor = <T extends { color?: unknown }>(patch: T, allowNeutral = false): T =>
    patch.color === undefined ? patch : { ...patch, color: snapColor(patch.color, allowNeutral) };

  // --- Write-shape wrappers ---------------------------------------------------------------------
  // Two rules used to be re-stated by hand in every action, so a NEW action could silently get
  // either one wrong: (1) the viewer gate must run BEFORE any assert, colour repair or persist, and
  // (2) an update must validate the MERGED row rather than the raw patch. The wrappers below make
  // both structural; each action then declares only what is specific to it.

  /** Run `fn` only when the caller may write; a blocked viewer gets `blockedValue` plus a notice and
   *  nothing runs. `fn` is first so TypeScript infers the return type from it and checks the blocked
   *  value against it — omit the value entirely for the void actions. */
  const guarded =
    <A extends unknown[], R>(fn: (...args: A) => R, blockedValue?: R) =>
    (...args: A): R =>
      blockedByViewer() ? (blockedValue as R) : fn(...args);

  /** The add* shape. `build` CONSTRUCTS the entity only — it may resolve the active account, but must
   *  never validate, repair a colour or persist — then the gate runs, then `persist` asserts/repairs/
   *  commits. So a blocked viewer gets back exactly the row they submitted, never a value we silently
   *  changed on their behalf, and nothing lands in state. Server 403 is the real backstop. */
  const guardedAdd =
    <A extends unknown[], E>(build: (...args: A) => E, persist: (built: E, ...args: A) => E) =>
    (...args: A): E => {
      const built = build(...args);
      return blockedByViewer() ? built : persist(built, ...args);
    };

  /** The update* shape: resolve the owned row (a stale id — e.g. a drag committed after an undo
   *  removed the row — is a benign no-op returning false), hand `prepare` the MERGED row so
   *  validation sees exactly what will be committed, then commit the patch `prepare` returns.
   *  Validating the raw patch instead used to let a note-only edit pass locally while the server —
   *  which always merges before it validates — rejected the full row, diverging local from synced
   *  state. `prepare` may also throw (surface, don't swallow) and may repair the patch it returns;
   *  `cascade` adds dependent table writes to that same mutation/history entry. */
  const updateOwned = <K extends ScopedEntityKey>(
    key: K,
    id: ID,
    patch: ScopedPatch<K>,
    prepare?: (merged: ScopedRow<K>, existing: ScopedRow<K>) => ScopedPatch<K>,
    cascade?: (data: AppData, merged: ScopedRow<K>, existing: ScopedRow<K>) => AppData,
  ): boolean => {
    const existing = findOwned(get().data, key, id);
    if (!existing) return false;
    const effective = prepare
      ? prepare(applyPatch(existing, patch as Partial<Omit<ScopedRow<K>, keyof Entity>>), existing)
      : patch;
    // The table key is generic here, so TS can't narrow d[key] to a single row type; K pins the row
    // and patch types at every call site above, which is where correctness is actually checked.
    mutate((d) => {
      const rows = updateById(d[key] as Entity[], id, effective as Partial<Entity>);
      const next = { ...d, [key]: rows } as AppData;
      return cascade
        ? cascade(next, applyPatch(existing, effective as Partial<Omit<ScopedRow<K>, keyof Entity>>), existing)
        : next;
    });
    return true;
  };

  // One shared implementation keeps single and repeated creation behavior identical. Build and
  // validate every row before mutate() so a bad middle draft cannot publish, persist or enter history.
  const addAllocationsImpl = (inputs: readonly Draft<Allocation>[]): Allocation[] => {
    if (inputs.length === 0) throw new Error("At least one allocation is required.");
    const accountId = requireAccount();
    const allocations = inputs.map((input) => ({
      ...input,
      hoursPerDay: clampHoursPerDay(input.hoursPerDay),
      id: newId(),
      accountId,
      ...stamp(),
    }));
    // Preserve the existing add* contract: a Viewer receives a constructed return value plus the
    // visible read-only notice, but no validation or state mutation runs. Hand-gated rather than
    // wrapped in `guarded`, whose blocked value is fixed up front: here it is the batch this call
    // just built, which only exists after the pre-check work above.
    if (blockedByViewer()) return allocations;
    const data = get().data;
    for (const allocation of allocations) {
      assertAllocation(
        data,
        accountId,
        allocation.resourceId,
        allocation.activityId,
        allocation.hoursPerDay,
        allocation.projectId,
      );
      assertDateRange(allocation.startDate, allocation.endDate);
    }
    mutate((d) => ({ ...d, allocations: [...d.allocations, ...allocations] }));
    return allocations;
  };

  // Replace the active account's slice from an import (see the importData action for the id-remap
  // rationale). Wrapped in the shared viewer gate, whose zero-effect summary reports honestly that
  // nothing was imported or skipped.
  const importSlice = guarded(
    (accountId: ID, incoming: AppData): ImportSummary => {
      const result = remapAndValidateImport(get().data, accountId, incoming, touch());
      // Refuse a zero-record import rather than wiping the account's existing slice.
      // Replacing a company's data with nothing is never the intent (delete is the
      // explicit path for that), and a truncated/empty file otherwise slips past the
      // shape-only file guard and silently clears the account.
      if (result.imported === 0) return { imported: 0, skipped: result.skipped };
      set((state) => ({
        data: result.data,
        past: [...state.past, state.data].slice(-HISTORY_LIMIT),
        future: [],
        // The incoming rows carry FRESH ids, so the entity lenses can no longer resolve; the search
        // text and the tentative/unmatched preferences are the user's own and survive.
        ui: { ...resetSchedulerView(state.ui), filters: clearEntityLenses(state.ui.filters) },
      }));
      return { imported: result.imported, skipped: result.skipped };
    },
    { imported: 0, skipped: 0 },
  );

  // clampHoursPerDay (allocations, [0,24]) and clampWorkingHoursPerDay (resources, (0,24])
  // come from the shared core (entities.ts) so the store write boundary and the import
  // sanitiser apply the IDENTICAL clamp — no per-path drift.

  return {
    data: emptyAppData(),
    activeAccountId: null,
    previousAccountId: null,
    accountSummaries: [],
    accountSummariesComplete: false,
    accountSummariesRequestId: 0,
    past: [],
    future: [],
    ...createRuntimeSlice(set, get, store),
    ...createSchedulerSlice(emptyFilters)(set, get, store),

    addAccount: guarded((input: Draft<Account>): Account | null => {
      const ts = stamp();
      const weekStartsOn = input.weekStartsOn ?? 1;
      if (input.workingDays !== undefined) assertWorkingDays(input.workingDays);
      // New-company defaults for the per-account view settings: brand-new tenants start in 'days'
      // scheduling with disciplines OFF, placeholder + external features hidden, and Internal work
      // grey. `...input`
      // comes LAST so a caller (or an import path) can still override any of them; existing/seed
      // accounts that never pass through addAccount keep their absent-field defaults (read via the
      // selectors). placeholdersEnabled/externalEnabled were device-global prefs and are now
      // per-account, mirroring disciplinesEnabled.
      const e: Account = {
        schedulingMode: "days",
        disciplinesEnabled: false,
        placeholdersEnabled: false,
        externalEnabled: false,
        internalColourMode: "grey",
        ...input,
        workingDays: normalizeAccountWorkingDays(input.workingDays, weekStartsOn),
        color: snapColor(input.color),
        id: newId(),
        ...ts,
      };
      // Every new account gets its built-in "Internal" client (one per account; see
      // internalClient.ts). Created atomically with the account so the one-per-account invariant
      // holds the instant the tenant exists — matching seed() and the v5→v6 migrate.
      const internal = buildInternalClient(e.id, ts.createdAt);
      mutate((d) => ({
        ...d,
        accounts: [...d.accounts, e],
        clients: [...d.clients, internal],
      }));
      // Keep the picker's list in lockstep (P1.13). This action now runs only in the DEMO build —
      // server-mode create goes through the AccountPicker's dedicated POST /api/orgs path, not here —
      // so this append is the demo bookkeeping that keeps the picker synchronously fresh before the
      // useAccountSummaries derive effect flushes. Append only if absent so a derive that already
      // added it can't duplicate.
      set((s) => ({
        accountSummariesRequestId: s.accountSummariesRequestId + 1,
        accountSummariesComplete: true,
        accountSummaries: s.accountSummaries.some((a) => a.id === e.id)
          ? s.accountSummaries
          : [...s.accountSummaries, { id: e.id, name: e.name, role: "owner" as const }],
      }));
      return e;
    }, null),
    updateAccount: guarded((id: ID, patch: Patch<Account>) => {
      const state = get();
      const existing = state.data.accounts.find((account) => account.id === id);
      if (!existing) return;
      if (state.activeAccountId !== id) {
        throw new Error("Cannot update a company other than the active company.");
      }
      if (patch.workingDays !== undefined) assertWorkingDays(patch.workingDays);
      const safePatch =
        patch.workingDays === undefined
          ? patch
          : {
              ...patch,
              workingDays: normalizeAccountWorkingDays(patch.workingDays, existing.weekStartsOn ?? 1),
            };
      mutate((d) => ({
        ...d,
        accounts: updateById(d.accounts, id, withSnappedColor(safePatch)),
      }));
    }),
    // Cascade-drop every scoped entity belonging to this account; if it was the
    // active one, fall back to the picker.
    deleteAccount: guarded((id: ID) => {
      if (!get().data.accounts.some((account) => account.id === id)) return;
      if (get().activeAccountId !== null && get().activeAccountId !== id) {
        throw new Error("Cannot delete a company other than the active company.");
      }
      set((s) => {
        const data = deleteAccountCascade(s.data, id);
        return {
          data,
          past: [],
          future: [],
          activeAccountId: s.activeAccountId === id ? null : s.activeAccountId,
          previousAccountId: s.activeAccountId === id ? id : s.previousAccountId,
          accountSummaries: s.accountSummaries.filter((account) => account.id !== id),
          accountSummariesComplete: true,
          accountSummariesRequestId: s.accountSummariesRequestId + 1,
          notice: null,
          ...clearedSession(),
          // No tenant remains in view, so the week is re-anchored on the app-default calendar.
          ui: resetSchedulerView(s.ui, weekAnchor(data, null)),
        };
      });
    }),
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
      let id = rawId;
      let unknownAccount = false;
      if (
        id !== null &&
        !get().data.accounts.some((a) => a.id === id) &&
        !get().accountSummaries.some((a) => a.id === id)
      ) {
        console.warn(`setActiveAccount: no company with id ${JSON.stringify(id)} — returning to the picker`);
        unknownAccount = true;
        id = null;
      }
      set((s) => {
        const switchingAccount = id !== s.activeAccountId;
        return {
          activeAccountId: id,
          // A concrete role means membership enforcement is active. Publish the new tenant with a
          // conservative Viewer role in this SAME store transition so no imperative subscriber can
          // observe it under the prior tenant's authority; PermissionProvider replaces it only
          // after resolving this account. null is the deliberate OFF/demo mode and stays editable.
          activeRole: id !== s.activeAccountId && s.activeRole !== null ? "viewer" : s.activeRole,
          activeRoleStatus: id !== s.activeAccountId && s.activeRole !== null ? "pending" : s.activeRoleStatus,
          // Remember where we came from when dropping to the picker (id === null) so it
          // can offer a "back" escape; clear it once a tenant is actually chosen.
          previousAccountId: id === null ? s.activeAccountId : null,
          past: [],
          future: [],
          // These values describe work or UI owned by the account being left. Clear them in the
          // same publication as activeAccountId so no subscriber can observe stale tenant ids,
          // form guards or messages under the new account.
          ...(switchingAccount
            ? {
                notice: unknownAccount
                  ? {
                      message: m.notice_company_not_found(),
                      tone: "error" as const,
                    }
                  : null,
                ...clearedSession(),
              }
            : {}),
          // Open the switched-into company on the current week (mirrors defaultUI) rather
          // than inheriting the previous tenant's panned origin/focus. The account's tz/weekStartsOn
          // come from its slice when loaded; in server mode the slice loads a frame later (the switch
          // orchestrator awaits the fetch), so fall back to the existing defaults for that one frame
          // (an acceptable transient — the grid re-anchors when the slice arrives via replaceAll).
          ui: resetSchedulerView(s.ui, weekAnchor(s.data, id)),
        };
      });
    },

    // Plain transient state (NOT mutate): never on the undo/redo stack or in AppData/export.
    beginAccountSummariesRequest: () => {
      const requestId = get().accountSummariesRequestId + 1;
      set({ accountSummariesRequestId: requestId });
      return requestId;
    },
    setAccountSummaries: (list, requestId, complete = true) => {
      if (requestId !== undefined) {
        if (requestId !== get().accountSummariesRequestId) return false;
        set({ accountSummaries: list, accountSummariesComplete: complete });
        return true;
      }
      // A direct mutation (optimistic create/delete, demo derivation or test setup) is newer than
      // every response already in flight, so advance the same sequence before publishing it.
      set((state) => ({
        accountSummaries: list,
        accountSummariesComplete: complete,
        accountSummariesRequestId: state.accountSummariesRequestId + 1,
      }));
      return true;
    },

    replaceAll: (data) =>
      set((state) => {
        const previouslyHadActiveAccount = state.activeAccountId
          ? state.data.accounts.some((candidate) => candidate.id === state.activeAccountId)
          : false;
        const account = state.activeAccountId
          ? data.accounts.find((candidate) => candidate.id === state.activeAccountId)
          : undefined;
        const unchangedActiveSlice = previouslyHadActiveAccount && hasSameEntityRevisions(state.data, data);
        // A replacement is a publication boundary: never retain an active id that the newly
        // published slice does not contain. This can happen after membership revocation, a malformed
        // response, recovery, or a direct store call. Clear the selection in the SAME state write so
        // observers cannot see the new data under the dead tenant even for one notification, and do
        // not retain it as the picker's "back" target. requireAccount independently enforces the same
        // invariant at every scoped mutation boundary.
        if (state.activeAccountId && !account) {
          return {
            data,
            activeAccountId: null,
            previousAccountId: null,
            activeRole: null,
            activeRoleStatus: "not-applicable",
            notice: {
              message: m.notice_company_not_found(),
              tone: "error" as const,
            },
            ...clearedSession(),
            past: [],
            future: [],
            // No anchor: a publication is not a navigation, so the week in view is left alone.
            ui: resetSchedulerView(state.ui),
          };
        }
        // Same-account refreshes reconcile server state in the background and must preserve the
        // week the user is viewing. Re-anchor only when setActiveAccount had to use its temporary
        // GMT/Monday fallback because the selected account was absent from the previous slice.
        if (!account || previouslyHadActiveAccount) {
          // A no-op server refresh may replace every object identity, but identical ids and
          // authoritative revisions prove that no row changed. Preserve undo/redo only in that
          // exact case. Any remote addition, deletion or revision change clears history because a
          // historical whole-slice snapshot could otherwise resurrect or overwrite remote work.
          return unchangedActiveSlice ? { data } : { data, past: [], future: [] };
        }
        return {
          data,
          past: [],
          future: [],
          ui: { ...state.ui, ...weekAnchor(data, account.id) },
        };
      }),
    // Replace only the active account's slice; other accounts and the account
    // list itself are untouched. Undoable via ⌘Z.
    //
    // Imported entities keep their relationships but are given FRESH ids. An
    // exported file carries the source account's ids; re-importing it into a
    // different account would otherwise collide — the store matches entities by
    // id GLOBALLY (updateById / cascade scan all accounts), so a shared id would
    // let an edit in one account silently rewrite another's row.
    // The account is resolved at the CALL, ahead of the shared viewer gate: replacing a slice with
    // NO active account is a programming error for every role, so requireAccount must still throw
    // where `guarded` would merely refuse. Viewer no-op (P1.12 defense-in-depth): a read-only user
    // can't replace the account slice, and gets a zero-effect summary so the caller reports honestly.
    importData: (incoming) => importSlice(requireAccount(), incoming),

    undo: guarded(() => {
      set((s) => {
        if (s.past.length === 0) return {};
        const previous = prepareHistoryTarget(s.data, s.past[s.past.length - 1]);
        return {
          data: previous,
          past: s.past.slice(0, -1),
          future: [s.data, ...s.future].slice(0, HISTORY_LIMIT),
        };
      });
    }),
    redo: guarded(() => {
      set((s) => {
        if (s.future.length === 0) return {};
        const next = prepareHistoryTarget(s.data, s.future[0]);
        return {
          data: next,
          future: s.future.slice(1),
          past: [...s.past, s.data].slice(-HISTORY_LIMIT),
        };
      });
    }),

    addDiscipline: guardedAdd(
      (input: Draft<Discipline>): Discipline => ({
        ...input,
        id: newId(),
        accountId: requireAccount(),
        ...stamp(),
      }),
      (e) => {
        const safe = withSnappedColor(e);
        mutate((d) => ({ ...d, disciplines: [...d.disciplines, safe] }));
        return safe;
      },
    ),
    updateDiscipline: guarded((id: ID, patch: Patch<Discipline>) => {
      updateOwned("disciplines", id, patch, () => withSnappedColor(patch));
    }),
    deleteDiscipline: guarded((id: ID) => {
      if (!findOwned(get().data, "disciplines", id)) return;
      mutate((d) => deleteDisciplineCascade(d, id, nextDataRevision(d)));
    }),

    addResource: guardedAdd(
      (input: Draft<Resource>): Resource => {
        // Placeholder drafts carry inert defaults for a complete entity contract; normalise them
        // again here so the store remains the authoritative last line for persisted values.
        const workingPattern = isPlaceholderResource(input)
          ? placeholderCapacityDefaults()
          : { workingDays: input.workingDays, halfDays: input.halfDays };
        return {
          ...input,
          ...workingPattern,
          // Engagement did not exist in older programmatic callers. Default them to Studio, and
          // keep placeholders/external rows outside the people classification by forcing Studio.
          engagement: input.kind === "person" ? (input.engagement ?? "studio") : "studio",
          // Clamp working hours/day (the store is the last line; resource forms write the fixed 8h,
          // but imports and other programmatic callers must not persist NaN / 0 / >24h capacity).
          // 0 is rejected (a resource works a positive day) — distinct from an allocation, where 0 is legal.
          workingHoursPerDay: clampWorkingHoursPerDay(input.workingHoursPerDay),
          id: newId(),
          accountId: requireAccount(),
          ...stamp(),
        };
      },
      (e, input) => {
        assertScopedRefs(get().data, e.accountId, "resources", input);
        assertWorkingDays(e.workingDays);
        assertHalfDays(e.halfDays, e.workingDays);
        // Colour snap runs LAST, right before persisting — never before the asserts above, so a
        // rejected (throwing) add never substitutes a colour onto an entity that was never saved.
        const safe = withSnappedColor(e, e.kind === "external");
        mutate((d) => ({ ...d, resources: [...d.resources, safe] }));
        return safe;
      },
    ),
    updateResource: guarded((id: ID, patch: Patch<Resource>) => {
      updateOwned("resources", id, patch, (merged, existing) => {
        patch = isPlaceholderResource(merged) ? { ...patch, ...placeholderCapacityDefaults() } : patch;
        merged = { ...existing, ...patch };
        // `existing` enables the unchanged-parent relaxation (see assertScopedRefs): an unchanged
        // placeholder projectId whose project is ARCHIVED (absent from the server-mode active-only
        // slice) must not block an unrelated edit; a CHANGED projectId is still validated strictly.
        assertScopedRefs(get().data, existing.accountId, "resources", patch, existing);
        // Flipping a resource to external while it still owns loaded work / time-off would orphan
        // those dependents (the scheduler hides external capacity + time-off). A no-op when the
        // resource isn't becoming external. Mirrors the server's validateWrite resources branch.
        assertResourceProjectAllowsDependents(get().data, existing.accountId, id, merged, existing);
        assertResourceKindAllowsDependents(get().data, existing.accountId, id, merged.kind);
        if (patch.workingDays !== undefined) assertWorkingDays(patch.workingDays);
        if (patch.workingDays !== undefined || patch.halfDays !== undefined) {
          assertHalfDays(merged.halfDays, merged.workingDays);
        }
        const engagementPatch = merged.kind !== "person" ? { ...patch, engagement: "studio" as const } : patch;
        const colorPatch = withSnappedColor(engagementPatch, merged.kind === "external");
        return patch.workingHoursPerDay !== undefined
          ? { ...colorPatch, workingHoursPerDay: clampWorkingHoursPerDay(patch.workingHoursPerDay) }
          : colorPatch;
      });
    }),

    addClient: guardedAdd(
      (input: Draft<Client>): Client => {
        // STORE-STRIP enforcement point (1) of the single-Internal invariant — see the canonical doc
        // in shared/src/data/internalClient.ts (the other two points are import fold + server reject).
        // `builtin` is excluded from Draft<Client> at the type level (only seed/addAccount/migrate may
        // mint the one Internal per account). Strip it at runtime too so an untyped/cast payload can't
        // smuggle `builtin: true` past the compile-time guard and create a SECOND builtin — that would
        // break the "exactly one Internal per account" invariant. See Draft<Client>.
        const stripped: Record<string, unknown> = { ...input };
        delete stripped.builtin;
        return {
          ...(stripped as Draft<Client>),
          id: newId(),
          accountId: requireAccount(),
          ...stamp(),
        };
      },
      (e) => {
        if (!hasUsablePrivateCodeName(e as unknown as Record<string, unknown>)) {
          throw new Error("A private client requires a code name.");
        }
        const safe = withSnappedColor(e);
        mutate((d) => ({ ...d, clients: [...d.clients, safe] }));
        return safe;
      },
    ),
    updateClient: guarded((id: ID, patch: Patch<Client>) => {
      // `builtin` is excluded from Patch<Client> at the type level; strip it at runtime too so an
      // untyped/cast patch can't PROMOTE a normal client to a second builtin (store-strip enforcement
      // point (1); canonical doc in shared/src/data/internalClient.ts).
      const stripped: Record<string, unknown> = { ...patch };
      delete stripped.builtin;
      const safe = stripped as Patch<Client>;
      updateOwned("clients", id, safe, (merged) => {
        // The built-in Internal client can't be renamed (or recoloured) — a fixed bucket.
        assertNotBuiltinClient("clients", id, "renamed");
        if (!hasUsablePrivateCodeName(merged as unknown as Record<string, unknown>)) {
          throw new Error("A private client requires a code name.");
        }
        return withSnappedColor(safe);
      });
    }),

    addProject: guardedAdd(
      (input: Draft<Project>): Project => ({ ...input, id: newId(), accountId: requireAccount(), ...stamp() }),
      (e, input) => {
        if (!hasUsablePrivateCodeName(e as unknown as Record<string, unknown>)) {
          throw new Error("A private project requires a code name.");
        }
        assertScopedRefs(get().data, e.accountId, "projects", input);
        const safe = withSnappedColor(e);
        mutate((d) => ({ ...d, projects: [...d.projects, safe] }));
        return safe;
      },
    ),
    updateProject: guarded((id: ID, patch: Patch<Project>) => {
      updateOwned("projects", id, patch, (merged, existing) => {
        if (!hasUsablePrivateCodeName(merged as unknown as Record<string, unknown>)) {
          throw new Error("A private project requires a code name.");
        }
        // `existing` enables the unchanged-parent relaxation (see assertScopedRefs): in server mode
        // the hydrated slice is active-only, so an unchanged clientId pointing at an ARCHIVED client
        // must not block an unrelated edit; a CHANGED clientId is still validated strictly.
        assertScopedRefs(get().data, existing.accountId, "projects", patch, existing);
        return withSnappedColor(patch);
      });
    }),

    addPhase: guardedAdd(
      (input: Draft<Phase>): Phase => ({ ...input, id: newId(), accountId: requireAccount(), ...stamp() }),
      (e, input) => {
        assertScopedRefs(get().data, e.accountId, "phases", input);
        mutate((d) => ({ ...d, phases: [...d.phases, e] }));
        return e;
      },
    ),
    updatePhase: guarded((id: ID, patch: Patch<Phase>) => {
      updateOwned("phases", id, patch, (_merged, existing) => {
        // `existing` enables the unchanged-parent relaxation (see assertScopedRefs) — same
        // archived-parent rationale as updateProject above.
        assertScopedRefs(get().data, existing.accountId, "phases", patch, existing);
        return patch;
      });
    }),
    deletePhase: guarded((id: ID) => {
      if (!findOwned(get().data, "phases", id)) return;
      mutate((d) => deletePhaseCascade(d, id, nextDataRevision(d)));
    }),

    addActivity: guardedAdd(
      (input: Draft<Activity>): Activity => ({ ...input, id: newId(), accountId: requireAccount(), ...stamp() }),
      (e, input) => {
        assertScopedRefs(get().data, e.accountId, "activities", input);
        mutate((d) => ({ ...d, activities: [...d.activities, e] }));
        return e;
      },
    ),
    updateActivity: guarded((id: ID, patch: Patch<Activity>) => {
      updateOwned(
        "activities",
        id,
        patch,
        (merged, existing) => {
          // A partial patch touching only projectId OR only phaseId must still be checked for
          // activity↔phase coherence against the row's OTHER field.
          assertScopedRefs(get().data, existing.accountId, "activities", { ...merged }, existing);
          assertActivityProjectAllowsDependents(get().data, existing.accountId, id, merged, existing);
          return patch;
        },
        (data, merged, existing) => ({
          ...data,
          allocations:
            allocationAttributionAllowed(existing.kind) && !allocationAttributionAllowed(merged.kind)
              ? data.allocations.map((allocation) =>
                  allocation.activityId === id && allocation.projectId !== undefined
                    ? withoutAllocationAttribution(allocation, touchAfter(allocation.updatedAt))
                    : allocation,
                )
              : data.allocations,
        }),
      );
    }),
    deleteActivity: guarded((id: ID) => {
      if (!findOwned(get().data, "activities", id)) return;
      mutate((d) => deleteActivityCascade(d, id));
    }),

    addAllocation: (input) => addAllocationsImpl([input])[0],
    addAllocations: addAllocationsImpl,
    updateAllocation: guarded(
      (id: ID, patch: Patch<Allocation>) =>
        updateOwned("allocations", id, patch, (merged, existing) => {
          // The server re-runs assertAllocationRefs on the full merged row on EVERY write, so a
          // note/status/date-only edit of an allocation whose resource is now EXTERNAL with a
          // non-zero load (legacy pre-v0.8.1 data, or after a resource kind-flip) would 400 there
          // while succeeding here. Validating `merged` (see updateOwned) rejects exactly what the
          // server rejects; a note-only patch on a valid (non-external) row still passes.
          assertAllocation(
            get().data,
            existing.accountId,
            merged.resourceId,
            merged.activityId,
            merged.hoursPerDay,
            merged.projectId,
            existing,
          );
          assertDateRange(merged.startDate, merged.endDate);
          // Repeat-series membership is system-owned at creation. An ordinary edit may change every
          // visible allocation field but cannot link, unlink or move the row between series.
          const safePatch = { ...patch };
          if (existing.seriesId === undefined) delete safePatch.seriesId;
          else safePatch.seriesId = existing.seriesId;
          // Clamp hours/day on the way in (a drag-resize rescale can exceed a real day).
          return safePatch.hoursPerDay !== undefined
            ? { ...safePatch, hoursPerDay: clampHoursPerDay(safePatch.hoursPerDay) }
            : safePatch;
        }),
      false,
    ),
    deleteAllocation: guarded((id: ID) => {
      if (!findOwned(get().data, "allocations", id)) return;
      mutate((d) => ({
        ...d,
        allocations: d.allocations.filter((a) => a.id !== id),
      }));
    }),
    deleteAllocationSeriesFrom: guarded((id: ID) => {
      const target = findOwned(get().data, "allocations", id);
      if (!target) return;
      if (!target.seriesId) throw new Error("This allocation is not part of a repeat series.");
      const { accountId, seriesId, startDate } = target;
      // One mutation produces one history snapshot and one persistence diff/batch: a single Undo
      // restores the whole tail, and server mode commits all DELETE operations transactionally.
      mutate((d) => ({
        ...d,
        allocations: d.allocations.filter(
          (allocation) =>
            allocation.accountId !== accountId || allocation.seriesId !== seriesId || allocation.startDate < startDate,
        ),
      }));
    }),

    addTimeOff: guardedAdd(
      (input: Draft<TimeOff>): TimeOff => ({ ...input, id: newId(), accountId: requireAccount(), ...stamp() }),
      (e, input) => {
        assertResourceExists(get().data, e.accountId, input.resourceId);
        assertDateRange(input.startDate, input.endDate);
        mutate((d) => ({ ...d, timeOff: [...d.timeOff, e] }));
        return e;
      },
    ),
    updateTimeOff: guarded((id: ID, patch: Patch<TimeOff>) => {
      updateOwned("timeOff", id, patch, (merged, existing) => {
        // Same merged-row rule as updateAllocation: the server re-runs assertResourceExists on the
        // full merged row, so a type/date/note-only edit of time-off on a now-EXTERNAL resource
        // would 400 there while succeeding here. See updateOwned.
        assertResourceExists(get().data, existing.accountId, merged.resourceId, existing);
        assertDateRange(merged.startDate, merged.endDate);
        return patch;
      });
    }),
    deleteTimeOff: guarded((id: ID) => {
      if (!findOwned(get().data, "timeOff", id)) return;
      mutate((d) => ({ ...d, timeOff: d.timeOff.filter((t) => t.id !== id) }));
    }),

    addClosure: guardedAdd(
      (input: Draft<Closure>): Closure => ({ ...input, id: newId(), accountId: requireAccount(), ...stamp() }),
      (closure) => {
        if (closure.name.trim().length === 0) domainError("closure_name_required", "Closure name is required.");
        assertDateRange(closure.startDate, closure.endDate);
        mutate((data) => ({ ...data, closures: [...data.closures, closure] }));
        return closure;
      },
    ),
    updateClosure: guarded((id: ID, patch: Patch<Closure>) => {
      updateOwned("closures", id, patch, (merged) => {
        if (merged.name.trim().length === 0) domainError("closure_name_required", "Closure name is required.");
        assertDateRange(merged.startDate, merged.endDate);
        return patch;
      });
    }),
    deleteClosure: guarded((id: ID) => {
      if (!findOwned(get().data, "closures", id)) return;
      mutate((data) => ({ ...data, closures: data.closures.filter((closure) => closure.id !== id) }));
    }),

    // --- Data-lifecycle actions (P2.5b DEMO-build path). See the StoreState block above for the
    // shared contract. Active → Archived → Soft-deleted → Purged is the ONLY removal path for the three
    // tombstone-carrying tables (resources / clients / projects); there is no immediate hard-delete
    // action for them — a physical row removal happens only at the END of the lifecycle, in purgeEntity,
    // which composes the shared delete*Cascade so the tombstone AND its children go together (a
    // resource's allocations/time-off; a client's projects/activities/allocations; a project's
    // phases/activities/allocations). Single-sourced from shared/lib/integrity.ts so the purge cascade
    // can't drift from the cascade the other tables' delete* actions use.
    archiveEntity: guarded((entity: LifecycleEntity, id: ID) => {
      if (!findOwned(get().data, entity, id)) return;
      assertNotBuiltinClient(entity, id, "archived");
      // archive() THROWS if the row isn't 'active' (defense-in-depth — the UI gates via canArchive
      // first). Surface-not-swallow: let it throw, exactly like the builtin guards above.
      mutate((d) => ({
        ...d,
        [entity]: d[entity].map((e) => {
          if (e.id !== id) return e;
          const now = touchAfter(e.updatedAt);
          return { ...archive(e, now), updatedAt: now };
        }),
      }));
    }),
    unarchiveEntity: guarded((entity: LifecycleEntity, id: ID) => {
      if (!findOwned(get().data, entity, id)) return;
      // No builtin guard: the Internal client can never reach 'archived' (archiveEntity rejects it), so
      // unarchive() would throw 'not archived' anyway. unarchive() THROWS if the row isn't archived.
      mutate((d) => ({
        ...d,
        [entity]: d[entity].map((e) => (e.id === id ? { ...unarchive(e), updatedAt: touchAfter(e.updatedAt) } : e)),
      }));
    }),
    softDeleteEntity: guarded((entity: LifecycleEntity, id: ID) => {
      if (!findOwned(get().data, entity, id)) return;
      // The Internal client can never be 'archived' (so softDelete would throw), but guard explicitly
      // for a display-safe message and parity with the delete path.
      assertNotBuiltinClient(entity, id, "deleted");
      // softDelete() THROWS unless the row is 'archived' (prior-archival rule). For a resource, COMPOSE
      // the shared obfuscateResource so the local tombstone carries NO original PII (the obfuscation
      // string is single-sourced from lifecycle.ts — never hand-written here).
      const applyDelete = (d: AppData): AppData => ({
        ...d,
        [entity]: d[entity].map((e) => {
          if (e.id !== id) return e;
          const now = touchAfter(e.updatedAt);
          const t = softDelete(e, now);
          const revision = t.deletedAt ?? now;
          return entity === "resources"
            ? { ...obfuscateResource(t as Resource), updatedAt: revision }
            : { ...t, updatedAt: revision };
        }),
        ...(entity === "resources"
          ? {
              allocations: d.allocations.map((a) =>
                a.resourceId === id && a.note != null
                  ? {
                      ...a,
                      note: undefined,
                      updatedAt: touchAfter(a.updatedAt),
                    }
                  : a,
              ),
              timeOff: d.timeOff.map((t) =>
                t.resourceId === id && t.note != null
                  ? {
                      ...t,
                      note: undefined,
                      updatedAt: touchAfter(t.updatedAt),
                    }
                  : t,
              ),
            }
          : {}),
      });
      // Lifecycle deletion is irreversible for every supported entity. Clear both history stacks
      // even when a client/project tombstone retains its display data: undo must never bypass the
      // archive → soft-delete lifecycle contract or resurrect a deliberately removed record.
      mutateIrreversible(applyDelete);
    }),
    purgeEntity: guarded((entity: LifecycleEntity, id: ID) => {
      const existing = findOwned(get().data, entity, id);
      if (!existing) return;
      // The built-in Internal client cannot be purged — every account must keep exactly one.
      assertNotBuiltinClient(entity, id, "deleted");
      // Enforce the grace window: canPurge is false unless this is a soft-deleted tombstone aged at
      // least PURGE_MIN_AGE_DAYS. A refused purge is a gated affordance, NOT corruption — surface a
      // notice and no-op rather than throw (the throw idiom is reserved for tenancy/integrity bugs).
      // Exact-instant "now", not date-only midnight: a midnight-truncated timestamp would let
      // the client stay up to ~24h more conservative than the server's own boundary check.
      if (!canPurge(existing, new Date().toISOString())) {
        get().setNotice(m.notice_purge_grace_window({ days: PURGE_MIN_AGE_DAYS }), "error");
        return;
      }
      // Hard purge: physically remove the row AND cascade its children (see PURGE_CASCADES).
      mutateIrreversible((d) => PURGE_CASCADES[entity](d, id));
    }),
  };
});
