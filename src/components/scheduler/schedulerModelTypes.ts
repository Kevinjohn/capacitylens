import type { LaneLayout } from "@/lib/lanePacking";
import type { DayCapacity } from "@/lib/capacity";
import type { DisciplineGroup } from "@/store/selectors";
import type { ColumnGeometry } from "./columnGeometry";
import type { Filters } from "@/store/useStore";
import type { Allocation, AppData, ID, ISODate, Resource, TimeOff, Weekday } from "@capacitylens/shared/types/entities";

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
  /** True when the assignee is an external / 3rd-party resource, the bar hides its hours. */
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
  /** This resource is on time off on this date. Decided here, in date space, so the lane cannot
   * reach a different answer by re-testing its time-off blocks in pixel space (narrowed weekend
   * columns make the two disagree). Always false for a capacity-starved (external) row. */
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
  /** Days reading as a capacity conflict (`over` or `timeOffConflict`), the count the row's
   * screen-reader summary announces. Tallied in the day loop that builds `dayStates`, because the
   * view would otherwise rescan every day of every row on every vertical scroll frame. */
  conflictDayCount: number;
  /** Days painted with the neutral half-day (partial capacity) treatment. Same reason as above. */
  partialCapacityDayCount: number;
  timeOff: TimeOffBlock[];
  utilization: number; // working-day ratio over the visible window [visStart, visEnd]
  overSoon: boolean; // over-allocated on >=1 working day inside the fixed forward window [overStart, overEnd]
  dimmed: boolean; // no work on the active project/client filter, shown for staffing context
}

export interface GroupModel {
  key: string;
  title: string;
  color?: string;
  /** True for the external / 3rd-party band. The view reads this (not the key string) to suppress
   * its utilisation average. */
  external: boolean;
  rows: RowModel[];
}

export interface SchedulerModelOptions {
  data: AppData;
  // Per-column pixel geometry (built once in SchedulerGrid). Owns the date→x / range→width
  // math so bars line up with the header even when weekend columns are narrowed; replaces the
  // Its origin (days[0]) equals ui.originDate.
  geom: ColumnGeometry;
  days: ISODate[];
  // Two separate windows, deliberately distinct (AGENTS.md / DECISIONS.md):
  //
  // - [visStart, visEnd] drives the displayed utilisation % (per-person `utilization`, and so the
  //   per-discipline avg + overall figures that average it). It tracks the currently visible span
  //   (the zoom range anchored at the scroll left-edge), so "63% utilisation" answers "over the
  //   weeks I'm looking at". SchedulerGrid passes this day-quantized (recomputed only when the
  //   left-edge day or the zoom changes, never per scroll pixel).
  // - [overStart, overEnd] drives the `overSoon` red flag only: a fixed forward window from today
  //   (UTILIZATION_WINDOW_DAYS), independent of zoom/pan, the second, zoom-independent "over soon"
  //   warning that must stay separate from the zoomable %. Don't widen it to the visible window.
  //
  // The per-day red marker is a third, distinct signal across the whole `days` timeline. It renders
  // for `dayStates.over` (allocated > available) or `dayStates.timeOffConflict` (a zero-load Block
  // overlaps time off). Hourly allocation remains weekend-aware, so a bar merely spanning Sat/Sun
  // does no weekend work; Blocks likewise do not flag ordinary personal/company non-working days.
  visibleWindow: { start: ISODate; end: ISODate };
  overSoonWindow: { start: ISODate; end: ISODate };
  filters: Filters;
  preferences: {
    // When false (account.disciplinesEnabled === false), discipline bands disappear and the
    // discipline filter is ignored. Capacity-tracked rows instead use the engagement fallback
    // bands, derived from the data (see hasSupplementaryResources in store/selectors.ts).
    disciplinesEnabled: boolean;
    // Per-account view pref (default off). When false, placeholder ("slot") resources are dropped
    // by `resourceVisible` below. This one filter removes the lane, its bars/day-states, and its
    // contribution to per-discipline + overall utilisation (both derive from this model). It is a
    // pure view pref: the placeholder resources and their allocations stay in the data untouched and
    // reappear when re-enabled. See selectors.ts / DECISIONS.md.
    placeholdersEnabled: boolean;
    // Per-account view pref (default off), the exact analog of `placeholdersEnabled` for external /
    // 3rd-party resources. When false, externals are dropped by `resourceVisible` below, the same
    // single chokepoint. Crucially that also empties the trailing external band, which the final
    // `.filter((g) => g.rows.length > 0)` then drops, so no empty "External / 3rd party" header
    // renders when externals are hidden. A pure view pref: external data is untouched and reappears
    // when re-enabled. See selectors.ts / DECISIONS.md.
    externalEnabled: boolean;
    /** Account-wide hard boundary for the start of a schedule creation gesture. */
    accountWorkingDays?: Weekday[];
    blocksMode?: boolean;
  };
  // Vertical lane geometry (see components/scheduler/layout.ts). It feeds `resolveLaneTop` /
  // `resolveRowHeightForLanes` below, so every bar's `top` and every row's `rowHeight` derive from it.
  // The grid passes `SCHEDULER_LANE_LAYOUT`. Defaults to the base `laneLayout` so callers that don't
  // care about density (tests, and any consumer measuring this layout) keep their existing numbers.
  laneLayout?: LaneLayout;
}

/** A row's capacity view of its own data. External / 3rd-party rows have no capacity: no
 * over-markers, no utilisation, no time-off blocks, an awareness band, not a bookable lane. That
 * starvation contract lives here, as capacity-free outputs behind the same shape the tracked path
 * fills, so the day loop below has one arm instead of two that have to be kept in step. `tracked`
 * is the flag that keeps a starved row's zero `available` from reading as "fully booked", only a
 * genuinely tracked resource can be made unavailable by its own capacity. */
export interface CapacitySource {
  tracked: boolean;
  /** The row's applicable personal time off covering one date. */
  listTimeOffOn: (date: ISODate) => TimeOff[];
  resolveCapacityOnDay: (date: ISODate) => DayCapacity;
  countAllocationsOn: (date: ISODate) => number;
  countTimeOffOn: (date: ISODate) => number;
  resolveUtilizationOver: (dates: ISODate[]) => number;
  isOverOn: (dates: ISODate[]) => boolean;
}
export interface SchedulerResourceGroup extends DisciplineGroup {
  key: string;
  title: string;
  color?: string;
}
