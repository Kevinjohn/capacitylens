import type { Draft, Patch } from "./entityDrafts";
import type { Filters } from "./filters";
import type { StoreEntityActions } from "./StoreEntityActions";
export * from "./entityDrafts";
export * from "./filters";
export * from "./StoreEntityActions";
import type { WeeksZoom } from "@/lib/schedulerConfig";
import type { BarLabelPreferences, UtilizationPreferences } from "@/lib/displayPrefs";
import type { ThemePreference } from "@/lib/theme";
import type { Role } from "@capacitylens/shared/domain/access";
import type { MasqueradeState } from "@capacitylens/shared/domain/masquerade";
import type { Account, AppData, ID, ISODate } from "@capacitylens/shared/types/entities";

export type MasqueradeRuntimeState =
  | { kind: "inactive" }
  | {
      kind: "starting";
      pending: { accountId: string; targetUserId: string };
      state?: MasqueradeState;
      generation: number;
    }
  | { kind: "active" | "ending"; state: MasqueradeState; generation: number };

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
 * The minimal per-login account summary that drives the AccountPicker — the server-sourced
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

type SetAccountSummariesOptions = {
  list: AccountSummary[];
  requestId?: number | undefined;
  complete?: boolean | undefined;
};
type SetDirtyFormSourceOptions = { source: symbol; dirty: boolean };
type SetUtilizationPrefOptions = { key: keyof UtilizationPreferences; value: boolean };
type SetBarLabelPrefOptions = { key: keyof BarLabelPreferences; value: boolean };

export interface StoreState extends StoreEntityActions {
  data: AppData;
  ui: SchedulerUI;
  hydrated: boolean;
  /** The tenant currently in view. Null = no account chosen (show the picker). Never persisted. */
  activeAccountId: ID | null;
  /** Account whose selected slice failed to hydrate. Transient and never persisted. */
  activeAccountLoadFailed: ID | null;
  /** The account that was active before switching to the picker — lets the picker
   *  offer a "back" escape after an accidental "Switch company". Never persisted. */
  previousAccountId: ID | null;
  /** The server-sourced list of accounts this login may open — the AccountPicker's data
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
  theme: ThemePreference;
  /** Utilisation display toggles. Device-global like `theme`, persisted to their
   *  own localStorage key — not part of account data. */
  utilizationPrefs: UtilizationPreferences;
  /** Allocation-bar label toggles (client/project context before the activity name).
   *  Device-global like `utilizationPrefs`, own localStorage key. */
  barLabelPrefs: BarLabelPreferences;
  /** Sidebar open (labels) vs collapsed (icon rail). Device-global like `theme`,
   *  own localStorage key; the first-run default is viewport-derived (collapsed
   *  on small screens, open on desktop). */
  sidebarOpen: boolean;
  /** Shrink the weekend (Sat/Sun) columns on the schedule to a sliver. Device-global like
   *  `theme`, own localStorage key, NOT in AppData/export — and defaults ON. */
  minimiseWeekends: boolean;
  /** After a FREE horizontal scroll settles, floor the grid's left edge to the current week's
   *  first day. Always true for users; read once from a test-only storage override (see
   *  `readStoredWeekSnapOverride`). The navigation snap (zoom / Prev-Next / date-picker) is
   *  independent of this flag. */
  weekSnapEnabled: boolean;
  /** COSMETIC demo "fake sign-in" state — gates a Google-style demo sign-in screen BEFORE
   *  the account picker so a viewer sees "log in first, then pick a company". Device-global
   *  like `theme` (own localStorage key, NOT in AppData/export), defaults OFF (signed out).
   *  NOT real auth — the real seam is `src/auth/`; the gate is active only when that auth is
   *  off. See `src/components/FakeSignIn.tsx`. */
  fakeSignedIn: boolean;
  /** The caller's resolved {@link Role} for the ACTIVE account, or null. Set by PermissionProvider
   * once it resolves the role from `GET /api/accounts`; null in OFF/local/not-fetched.
   *  Transient (never persisted, never on the undo stack). It powers ONLY the defense-in-depth
   *  mutation guard below (assertCanWrite): a scoped mutation NO-OPS when this is exactly 'viewer',
   *  so an ungated affordance or an optimistic write that the server would 403 can't desync local
   *  state. The server 403 is the TRUE security backstop — this is UX/defense-in-depth, NOT
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

  /** Create a company with its built-in Internal client and list it for the picker. Null when a Viewer is blocked. */
  addAccount: (input: Draft<Account>) => Account | null;
  /** Patch a company's settings; undoable. Throws a display-safe `Error` on invalid working days. */
  updateAccount: (id: ID, patch: Patch<Account>) => void;
  /**
   * Delete a company and everything it owns, clearing undo history. With a company active, only that
   * company may be deleted and any other id throws; from the picker (no active company) any existing
   * company may be deleted. An unknown id is ignored.
   */
  deleteAccount: (id: ID) => void;
  /** Enter a company, or pass null for the picker. Clears undo history; an unknown id returns to the picker with a notice. */
  setActiveAccount: (id: ID | null) => void;
  /** Start one server-directory read and return its monotonic identity. */
  beginAccountSummariesRequest: () => number;
  /** Replace the picker list. A request-bound result applies only while it is still the latest;
   *  an unbound direct mutation invalidates every in-flight request. Returns whether it applied. */
  setAccountSummaries: (options: SetAccountSummariesOptions) => boolean;

  /** Publish freshly loaded data. Leaves the company, with a notice, when the active one is no longer present. */
  replaceAll: (data: AppData) => void;
  /** Replace the active account's slice from an import; undoable via ⌘Z. Returns a
   *  summary of how many records were brought in vs. dropped as invalid. */
  importData: (data: AppData) => ImportSummary;
  /** Record whether the initial load has finished. */
  setHydrated: (value: boolean) => void;
  /** Record whether the latest save failed. */
  setPersistError: (value: boolean) => void;
  /** Record whether stored local data could not be read. */
  setLoadError: (value: boolean) => void;
  /** Record whether the server could not be reached. */
  setConnectionError: (value: boolean) => void;
  /** Show a notice with the given tone (default `info`), or clear it with null. */
  setNotice: (message: string | null, tone?: "info" | "warning" | "error") => void;
  /** Announce a capacity outcome to the grid's polite aria-live region (WCAG 4.1.3). Bumps `seq`
   *  so the SAME text re-announces (an aria-live region re-reads only on a content change). Call
   *  ONLY after a successful KEYBOARD-committed allocation edit — pointer drags give sighted
   *  feedback and must not announce. Transient, never persisted/undone. */
  announceCapacity: (text: string) => void;
  /** Set the unsaved-work flag directly; prefer `setDirtyFormSource` for per-component ownership. */
  setDirtyForm: (value: boolean) => void;
  /** Publish or clear one component's dirty contribution without disturbing another owner. */
  setDirtyFormSource: (options: SetDirtyFormSourceOptions) => void;
  /** Mark/clear the allocation being dragged (drives the grid's drag-pin). */
  setDraggingAllocation: (id: ID | null) => void;
  /** Set the colour-scheme preference: persist it, repaint the DOM, update state. */
  setTheme: (pref: ThemePreference) => void;
  /** Toggle a single utilisation display preference: persist and update state. */
  setUtilizationPref: (options: SetUtilizationPrefOptions) => void;
  /** Toggle a single bar-label display preference: persist and update state. */
  setBarLabelPref: (options: SetBarLabelPrefOptions) => void;
  /** Open/collapse the sidebar: persist the choice and update state. */
  setSidebarOpen: (open: boolean) => void;
  /** Toggle the minimise-weekends preference: persist and update state. */
  setMinimiseWeekends: (value: boolean) => void;
  /** Set the cosmetic fake-sign-in state: persist and update state. */
  setFakeSignedIn: (value: boolean) => void;
  /** Set the active account's resolved role — called by PermissionProvider whenever it
   *  resolves/changes the role (incl. back to null on OFF/local/account-switch). Plain transient
   *  state: never persisted, never on the undo stack. Drives ONLY the defense-in-depth write guard. */
  setActiveRole: (role: Role | null, status?: "not-applicable" | "pending" | "resolved" | "unavailable") => void;
  /** Invalidate all client projections derived from account membership. */
  invalidateMemberships: () => void;
  /** Replace the view-as-member runtime state. */
  setMasquerade: (state: MasqueradeRuntimeState) => void;
  /** Empty both undo and redo stacks. */
  clearUndoHistory: () => void;
  /** Sign out of the cosmetic demo: drop the active company AND the "back" breadcrumb, then
   *  clear the device-global flag so the demo sign-in shows again. Cosmetic only — never
   *  touches the real auth seam (`src/auth/`); both call sites are guarded by `authMode === 'off'`. */
  signOutDemo: () => void;
  /** Restore the previous data snapshot, if any. */
  undo: () => void;
  /** Re-apply the most recently undone snapshot, if any. */
  redo: () => void;

  /** Set how many weeks the schedule shows. */
  setZoom: (zoom: WeeksZoom) => void;
  /** Set the first date in view without snapping to a week start. */
  setOriginDate: (date: ISODate) => void;
  /** Move the first date in view by `delta` days; negative moves back. */
  panDays: (delta: number) => void;
  /** Bring the current week into view. */
  goToToday: () => void;
  /** Bring the week containing `date` into view, using the company's week start. */
  goToDate: (date: ISODate) => void;
  /** Choose whether drawing on a lane creates work or time off. */
  setDrawMode: (mode: DrawMode) => void;
  /** Select an allocation, or clear the selection with null. */
  selectAllocation: (id: ID | null) => void;
  /** Merge a partial patch into the schedule filters. */
  setFilters: (patch: Partial<Filters>) => void;
  /** Reset every schedule filter. */
  clearFilters: () => void;
  /** Collapse or expand the schedule group with this key. */
  toggleGroup: (key: string) => void;
  /** Clear schedule filters (so the resource row is visible) then set
   *  scrollToResource — SchedulerGrid watches this to scroll the row into view.
   *  Transient UI: NOT persisted, NOT on the undo stack. */
  jumpToResource: (id: ID) => void;
  /** Mark one exact resource-jump token consumed after its row was scrolled into view. A stale
   *  acknowledgement never consumes a newer request. */
  consumeResourceJump: (token: number) => void;
}
