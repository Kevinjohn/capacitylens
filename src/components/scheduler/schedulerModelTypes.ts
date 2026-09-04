import type { LaneLayout } from "../../lib/lanePacking";
import type { DayCapacity } from "../../lib/capacity";
import type { DisciplineGroup } from "../../store/selectors";
import type { ColumnGeometry } from "./columnGeometry";
import type { Filters } from "../../store/useStore";
import type {
  Allocation,
  AppData,
  ID,
  InternalColourMode,
  ISODate,
  Resource,
  TimeOff,
  Weekday,
} from "@capacitylens/shared/types/entities";

/** A positioned allocation bar. */
export interface BarLayout {
  allocation: Allocation;
  x: number;
  width: number;
  top: number;
  color: string;
  label: string;
  project?: string;
  client?: string;
  /** Last surviving occurrence end in this modern linked series; absent for one-offs and legacy batches. */
  seriesEnd?: ISODate;
  /** True when the assignee is an external / 3rd-party resource — the bar hides its hours. */
  external: boolean;
}

/** Per-day capacity state for a lane background cell. */
export interface DayState {
  over: boolean;
  /** Capacity-relevant work or a Block placement overlaps this resource's time off. Kept separate
   * from hourly `over` so Blocks can show the conflict while retaining zero capacity consumption. */
  timeOffConflict: boolean;
  unavailable: boolean;
  /** This resource has a saved half-day working pattern on this date. Suppressed when another
   * rule makes the whole date unavailable, so the view never paints contradictory backgrounds. */
  partialCapacity: boolean;
  creationBlocked: boolean;
  /** This resource is on time off on this date. Decided HERE, in date space, so the lane cannot
   *  reach a different answer by re-testing its time-off blocks in PIXEL space (narrowed weekend
   *  columns make the two disagree). Always false for a capacity-starved (external) row. */
  hasTimeOff: boolean;
}

/** A positioned time-off block. */
export interface TimeOffBlock {
  id: ID;
  x: number;
  width: number;
  label: string;
  note?: string;
}

export interface RowModel {
  resource: Resource;
  rowHeight: number;
  bars: BarLayout[];
  dayStates: DayState[];
  /** Days reading as a capacity conflict (`over` OR `timeOffConflict`) — the count the row's
   *  screen-reader summary announces. Tallied in the day loop that builds `dayStates`, because the
   *  view would otherwise rescan every day of every row on every vertical scroll frame. */
  conflictDayCount: number;
  /** Days painted with the neutral half-day (partial capacity) treatment. Same reason as above. */
  partialCapacityDayCount: number;
  timeOff: TimeOffBlock[];
  utilization: number; // working-day ratio over the VISIBLE window [visStart, visEnd]
  overSoon: boolean; // over-allocated on >=1 working day inside the FIXED forward window [overStart, overEnd]
  dimmed: boolean; // no work on the active project/client filter — shown for staffing context
}

export interface GroupModel {
  key: string;
  title: string;
  color?: string;
  /** True for the external / 3rd-party band. The view reads THIS (not the key string) to suppress
   *  its utilisation average. */
  external: boolean;
  rows: RowModel[];
}

export interface SchedulerModelOptions {
  data: AppData;
  // Per-column pixel geometry (built once in SchedulerGrid). Owns the date→x / range→width
  // math so bars line up with the header even when weekend columns are narrowed; replaces the
  // old uniform `origin` + `dayWidth` scalars. Its origin (days[0]) === ui.originDate.
  geom: ColumnGeometry;
  days: ISODate[];
  // TWO separate windows, deliberately distinct (CLAUDE.md / DECISIONS.md):
  //
  // - [visStart, visEnd] drives the DISPLAYED utilisation % (per-person `utilization`, and so the
  //   per-discipline avg + overall figures that average it). It tracks the currently VISIBLE span
  //   (the zoom range anchored at the scroll left-edge), so "63% utilisation" answers "over the
  //   weeks I'm looking at". SchedulerGrid passes this day-quantized (recomputed only when the
  //   left-edge DAY or the zoom changes, never per scroll pixel).
  // - [overStart, overEnd] drives the `overSoon` red flag ONLY: a FIXED forward window from today
  //   (UTILIZATION_WINDOW_DAYS), independent of zoom/pan — the second, zoom-independent "over soon"
  //   warning that must stay separate from the zoomable %. Don't widen it to the visible window.
  //
  // The per-day red marker is a THIRD, distinct signal across the whole `days` timeline. It renders
  // for `dayStates.over` (allocated > available) or `dayStates.timeOffConflict` (a zero-load Block
  // overlaps time off). Hourly allocation remains weekend-aware, so a bar merely spanning Sat/Sun
  // does no weekend work; Blocks likewise do not flag ordinary personal/company non-working days.
  visibleWindow: { start: ISODate; end: ISODate };
  overSoonWindow: { start: ISODate; end: ISODate };
  filters: Filters;
  preferences: {
    // When false (account.disciplinesEnabled === false), discipline bands disappear and the
    // discipline filter is ignored. Capacity-tracked rows instead use the engagement fallback
    // bands described by groupResourcesByEngagement below.
    disciplinesEnabled: boolean;
    // Per-account view pref (default OFF). When false, placeholder ("slot") resources are dropped
    // by `resourceVisible` below — this ONE filter removes the lane, its bars/day-states, AND its
    // contribution to per-discipline + overall utilisation (both derive from this model). It is a
    // pure VIEW pref: the placeholder resources and their allocations stay in the data untouched and
    // reappear when re-enabled. See selectors.ts / DECISIONS.md.
    placeholdersEnabled: boolean;
    // Per-account view pref (default OFF), the EXACT analog of `placeholdersEnabled` for external /
    // 3rd-party resources. When false, externals are dropped by `resourceVisible` below — the same
    // single chokepoint. Crucially that also empties the trailing external band, which the final
    // `.filter((g) => g.rows.length > 0)` then drops, so NO empty "External / 3rd party" header
    // renders when externals are hidden. A pure VIEW pref: external data is untouched and reappears
    // when re-enabled. See selectors.ts / DECISIONS.md.
    externalEnabled: boolean;
    /** Account-wide hard boundary for the start of a schedule creation gesture. */
    accountWorkingDays?: Weekday[];
    /** Default-on company preference: Studio then Supplementary, favourites first within each.
     *  It also owns the unassigned schedule fallback; false produces one Unassigned band. */
    groupResourcesByEngagement?: boolean;
    blocksMode?: boolean;
    // Per-account Internal-work display preference. Grey is the absent/default mode; palette mode
    // restores the normal project/resource colour path without changing persisted entity colours.
    internalColourMode?: InternalColourMode;
    // Per-account BAR-ONLY view prefs (both default ON). When false they hide, from the schedule bars
    // ONLY, allocations on internal PROJECTS (activity kind 'project' whose project's client is the
    // built-in Internal client) / internal ACTIVITIES (kind 'internal' ONLY — all-projects
    // 'repeatable' work is a distinct third group and is never hidden) respectively. See the
    // `barVisibleByInternalPref` filter below for the truthful-utilisation guarantee.
    showInternalProjects?: boolean;
    showInternalActivities?: boolean;
  };
  // Vertical geometry for the current density ("Compact view" device pref — see
  // components/scheduler/layout.ts). It feeds `laneTop` / `rowHeightForLanes` below, so every bar's
  // `top` and every row's `rowHeight` derive from it. SchedulerGrid passes `laneLayoutFor(compact)`
  // and lists it as a memo dependency, or a density change would leave stale row heights behind.
  // Defaults to the compact geometry so callers that don't care about density (tests, and any
  // consumer measuring the original layout) keep their existing numbers.
  laneLayout?: LaneLayout;
}

/** A row's capacity view of its own data. External / 3rd-party rows have NO capacity: no
 *  over-markers, no utilisation, no time-off blocks — an awareness band, not a bookable lane. That
 *  STARVATION CONTRACT lives HERE, as capacity-free outputs behind the same shape the tracked path
 *  fills, so the day loop below has one arm instead of two that have to be kept in step. `tracked`
 *  is the flag that keeps a starved row's zero `available` from reading as "fully booked" — only a
 *  genuinely tracked resource can be made unavailable by its own capacity. */
export interface CapacitySource {
  tracked: boolean;
  /** The row's applicable personal time off covering one date. */
  timeOffOn: (date: ISODate) => TimeOff[];
  capacityOnDay: (date: ISODate) => DayCapacity;
  allocationCountOn: (date: ISODate) => number;
  timeOffCountOn: (date: ISODate) => number;
  utilizationOver: (dates: ISODate[]) => number;
  overOn: (dates: ISODate[]) => boolean;
}
export interface SchedulerResourceGroup extends DisciplineGroup {
  key: string;
  title: string;
  color?: string;
}
