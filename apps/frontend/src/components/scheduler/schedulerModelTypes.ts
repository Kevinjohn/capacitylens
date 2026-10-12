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
  /** Last surviving end date in a linked repeat series; absent for one-offs and unlinked batches. */
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

/** A scheduler row with its resource, height, and rendered bar layout. */
export interface RowModel {
  resource: Resource;
  rowHeight: number;
  bars: BarLayout[];
  dayStates: DayState[];
  /** Conflict count across the materialized timeline, combining hourly overload and block/time-off conflicts. Precompute it with day states so vertical scrolling does not rescan the row. */
  conflictDayCount: number;
  /** Half-day count across the materialized timeline, precomputed with day states. */
  partialCapacityDayCount: number;
  timeOff: TimeOffBlock[];
  // This ratio includes only available days in the current visible window.
  utilization: number;
  // This flag uses the fixed forward window and requires allocation above availability.
  overSoon: boolean;

  dimmed: boolean;
}

/** A scheduler group key with its display title and optional color. */
export interface GroupModel {
  key: string;
  title: string;
  color?: string;
  /** True for the external / 3rd-party band. The view reads this (not the key string) to suppress
   * its utilisation average. */
  external: boolean;
  rows: RowModel[];
}

/** Data and column geometry used to build a scheduler model. */
export interface SchedulerModelOptions {
  data: AppData;
  // The geometry origin must match days[0] and ui.originDate so date headers, bars and narrowed weekend columns share one alignment.
  geom: ColumnGeometry;
  days: ISODate[];
  // Visible utilisation follows the zoom/pan window; overSoon follows the fixed forward window from today. Per-day conflict markers cover the materialized timeline. Keep these three boundaries separate.
  visibleWindow: { start: ISODate; end: ISODate };
  overSoonWindow: { start: ISODate; end: ISODate };
  filters: Filters;
  preferences: {
    // When false (account.disciplinesEnabled === false), discipline bands disappear and the
    // discipline filter is ignored. Capacity-tracked rows instead use the engagement fallback
    // bands, derived from the data (see hasSupplementaryResources in store/selectors.ts).
    disciplinesEnabled: boolean;
    // When disabled, placeholders remain persisted but are omitted from rows and utilisation aggregates. The setting defaults off.
    placeholdersEnabled: boolean;
    // When disabled, external data remains persisted but neither its rows nor an empty group header appear. The setting defaults off.
    externalEnabled: boolean;
    /** Account-wide hard boundary for the start of a schedule creation gesture. */
    accountWorkingDays?: Weekday[];
    blocksMode?: boolean;
  };
  // Lane geometry controls both bar positions and row heights. The grid supplies its density projection; callers omitting it receive the base layout.
  laneLayout?: LaneLayout;
}

/** Capacity projection for one row. External rows can hold scheduled allocations but carry no utilisation, overload or personal time-off capacity cues. tracked distinguishes their zero-capacity projection from unavailable tracked resources. */
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
/** A discipline group with scheduler-specific display fields. */
export interface SchedulerResourceGroup extends DisciplineGroup {
  key: string;
  title: string;
  color?: string;
}
