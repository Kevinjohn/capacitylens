import type { Patch } from './entityDrafts';
import type { Filters } from './filters';
import type { StoreEntityActions } from './StoreEntityActions';
export * from './entityDrafts';
export * from './filters';
export * from './StoreEntityActions';
import type { WeeksZoom } from '@/lib/schedulerConfig';
import type { BarLabelPreferences, UtilizationPreferences } from '@/lib/displayPrefs';
import type { ThemePreference } from '@/lib/theme';
import type { Role } from '@capacitylens/shared/domain/access';
import type { MasqueradeState } from '@capacitylens/shared/domain/masquerade';
import type { Account, AppData, ID, ISODate } from '@capacitylens/shared/types/entities';
import type { PlanningControllerMetadata } from '@/data/planning/planningCacheController';
import type { PlanningCommand } from '@/data/planning/planningCommands';

/** Runtime state for the current masquerade session. */
export type MasqueradeRuntimeState =
  | { kind: 'inactive' }
  | {
      kind: 'starting';
      pending: { accountId: string; targetUserId: string };
      state?: MasqueradeState;
      generation: number;
    }
  | { kind: 'active' | 'ending'; state: MasqueradeState; generation: number };

/** A user notice and severity. Info auto-dismisses; warnings and errors remain until
 * dismissed so consequential advisories and failures can be read. Warnings use the
 * neutral treatment and errors use the danger accent.
 */
export interface Notice {
  message: string;
  tone: 'info' | 'warning' | 'error';
}

/** A directory entry for a company the current identity may access. Entries stay separate
 * from the active company slice. An unavailable role stays unresolved until refreshed.
 */
export interface AccountSummary {
  id: ID;
  name: string;
  role: Role;
  roleStatus?: 'resolved' | 'unavailable';
}

export type { WeeksZoom };

/** What a draw-on-a-lane gesture creates. */
export type DrawMode = 'work' | 'timeoff';

/** UI state that controls scheduler zoom, range, and interaction modes. */
export interface SchedulerUI {
  /** Number of visible weeks used to derive column width. */
  zoom: WeeksZoom;
  originDate: ISODate;
  rangeDays: number;
  /** Date brought into view by a recenter request. */
  focusDate: ISODate;
  /** Entity kind created by a lane draw gesture. */
  drawMode: DrawMode;
  selectedAllocationId: ID | null;
  filters: Filters;
  /** Keys of collapsed discipline groups. */
  collapsedGroups: string[];
  /** Token that requests focusDate be brought back into view. */
  recenterToken: number;
  /** Transient resource-row jump. Each request starts unconsumed; SchedulerGrid consumes it only
   * after finding and scrolling the row, so a temporarily hidden row can retry without replaying
   * after success. Token-per-request supports repeated jumps to the same id. Never persisted or
   * placed on the undo stack. */
  scrollToResource: { id: ID; token: number; consumed: boolean } | null;
}

type SetAccountSummariesOptions = {
  list: AccountSummary[];
  requestId?: number | undefined;
  complete?: boolean | undefined;
  ambiguous?: boolean | undefined;
};
type SetDirtyFormSourceOptions = { source: symbol; dirty: boolean };
type SetUtilizationPrefOptions = { key: keyof UtilizationPreferences; value: boolean };
type SetBarLabelPrefOptions = { key: keyof BarLabelPreferences; value: boolean };

/** Public state and actions exposed by the application store. */
export interface StoreState extends StoreEntityActions {
  data: AppData;
  ui: SchedulerUI;
  hydrated: boolean;
  /** The company currently in view, or null when no company is active. Never persisted. */
  activeAccountId: ID | null;
  /** Account whose selected slice failed to hydrate. Transient and never persisted. */
  activeAccountLoadFailed: ID | null;
  /** The server-sourced directory of companies this login may access. Set by useAccountSummaries
   * from the login’s memberships. Separate from `data` because `data` holds only the active slice.
   * Never persisted. */
  accountSummaries: AccountSummary[];
  /** Whether the published directory was wholly valid. A partial response cannot prove uniqueness.
   * Transient and never persisted. */
  accountSummariesComplete: boolean;
  /** A server directory read found multiple installation companies. Kept until an authoritative refresh/reset. */
  accountSummariesAmbiguous: boolean;
  /** Latest issued server-directory read. Direct list mutations advance this too, so an older
   * response cannot overwrite a create/delete/join result. Transient and never persisted. */
  accountSummariesRequestId: number;
  /** Planning cache metadata, including the typed allocation Undo/Redo history. Page-local. */
  planning: PlanningControllerMetadata;
  /** Advances only when a current planning request confirms that sign-in authority was lost. */
  planningAuthLossVersion: number;
  /** Submit one typed planning command and resolve after authoritative reconciliation. */
  sendPlanningCommand: (command: PlanningCommand, original?: unknown) => Promise<void>;
  /** Current user notice, or null. Dismissal and treatment follow Notice. */
  notice: Notice | null;
  /** Latest keyboard capacity announcement and sequence token. The token makes equal
   * consecutive messages announce again. Pointer gestures do not publish announcements.
   * Transient and excluded from persistence and undo history.
   */
  srAnnouncement: { text: string; seq: number } | null;
  /** True while any registered form/operation has unsaved work, drives the unsaved-changes guards
   * (modal backdrop/Escape, beforeunload). Derived from source ownership, never persisted. */
  dirtyForm: boolean;
  /** Internal owner set from which dirtyForm is derived. Transient and never persisted. */
  dirtyFormSources: ReadonlySet<symbol>;
  /** The allocation currently being dragged/resized, or null. Transient UI (like
   * dirtyForm), never persisted, never on the undo stack. Lets the scheduler pin the
   * dragged row so a mid-gesture vertical scroll can't virtualise it out and orphan the
   * drag (the document pointer listeners would be torn down on unmount). */
  draggingAllocationId: ID | null;
  /** Colour-scheme preference. Device-global, not part of account data: kept in the
   * store only for reactivity, persisted to its own localStorage key by setTheme. */
  theme: ThemePreference;
  /** Utilisation display toggles. Device-global like `theme`, persisted to their
   * own localStorage key, not part of account data. */
  utilizationPrefs: UtilizationPreferences;
  /** Allocation-bar label toggles (client/project context before the activity name).
   * Device-global like `utilizationPrefs`, own localStorage key. */
  barLabelPrefs: BarLabelPreferences;
  /** Sidebar open (labels) vs collapsed (icon rail). Device-global like `theme`,
   * own localStorage key; the first-run default is viewport-derived (collapsed
   * on small screens, open on desktop). */
  sidebarOpen: boolean;
  /** Shrink the weekend (Sat/Sun) columns on the schedule to a sliver. Device-global like
   * `theme`, own localStorage key, not in AppData/export, and defaults on. */
  minimiseWeekends: boolean;
  /** After a free horizontal scroll settles, floor the grid's left edge to the current week's
   * first day. Always true for users; read once from a test-only storage override (see
   * `readStoredWeekSnapOverride`). The navigation snap (zoom / Prev-Next / date-picker) is
   * independent of this flag. */
  weekSnapEnabled: boolean;
  /** Current company role or a fail-closed Viewer projection while role resolution is
   * pending or unavailable. Null applies when identity roles are not applicable.
   * Transient; the store guard supplements independent server authorization.
   */
  activeRole: Role | null;
  /** Why a fail-closed Viewer projection is active. Keeps mutation notices factual while role
   * resolution is pending/unavailable; transient and never persisted. */
  activeRoleStatus: 'not-applicable' | 'pending' | 'resolved' | 'unavailable';
  /** Monotonic invalidation token for server-owned membership state. Member mutations bump it so
   * the current directory-request owner re-reads the caller's effective role/list without an
   * account switch or page reload. Transient: never persisted or included in undo history. */
  membershipRevision: number;
  /** Session-backed read projection. Every non-inactive phase blocks local writes while the
   * controller establishes or removes the authoritative server projection. */
  masquerade: MasqueradeRuntimeState;

  /** Patch a company's settings; undoable. Throws a display-safe `Error` on invalid working days. */
  updateAccount: (id: ID, patch: Patch<Account>) => Promise<void>;
  /** Enter a company, or clear the active company. An unknown id clears selection with a notice. */
  setActiveAccount: (id: ID | null) => void;
  /** Start one server-directory read and return its monotonic identity. */
  beginAccountSummariesRequest: () => number;
  /** Replace the company directory. A request-bound result applies only while it is still the latest;
   * an unbound direct mutation invalidates every in-flight request. Returns whether it applied. */
  setAccountSummaries: (options: SetAccountSummariesOptions) => boolean;

  /** Record whether the initial load has finished. */
  setHydrated: (value: boolean) => void;
  /** Show a notice with the given tone (default `info`), or clear it with null. */
  setNotice: (message: string | null, tone?: 'info' | 'warning' | 'error') => void;
  /** Announce a capacity outcome to the grid's polite aria-live region (WCAG 4.1.3). Bumps `seq`
   * so the same text re-announces (an aria-live region re-reads only on a content change). Call
   * only after a successful keyboard-committed allocation edit, pointer drags give sighted
   * feedback and must not announce. Transient, never persisted/undone. */
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
  /** Publishes the current role or fail-closed Viewer projection and its resolution status.
   * Transient and excluded from persistence and undo history.
   */
  setActiveRole: (
    role: Role | null,
    status?: 'not-applicable' | 'pending' | 'resolved' | 'unavailable',
  ) => void;
  /** Invalidate all client projections derived from account membership. */
  invalidateMemberships: () => void;
  /** Replace the view-as-member runtime state. */
  setMasquerade: (state: MasqueradeRuntimeState) => void;
  /** Load the active company's canonical planning snapshot, entering its planning context first. */
  refreshPlanning: (options?: { fresh?: boolean }) => Promise<boolean>;
  /** End the current planning context and discard private planning rows. */
  clearPlanning: () => void;
  /** Atomically claim an out-of-band replacement; release is idempotent for its context. */
  suspendPlanningCommands: () => (() => void) | null;
  /** Whether the active canonical planning view is settled enough for a bulk replacement. */
  planningReadyForReplacement: () => boolean;
  /** Undo the latest typed allocation change as one typed planning write. */
  undoPlanning: () => Promise<boolean>;
  /** Redo the latest undone typed allocation change as one typed planning write. */
  redoPlanning: () => Promise<boolean>;

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
   * scrollToResource, SchedulerGrid watches this to scroll the row into view.
   * Transient UI: not persisted, not on the undo stack. */
  jumpToResource: (id: ID) => void;
  /** Mark one exact resource-jump token consumed after its row was scrolled into view. A stale
   * acknowledgement never consumes a newer request. */
  consumeResourceJump: (token: number) => void;
}
