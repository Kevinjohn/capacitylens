import { laneTop, packLanes, rowHeightForLanes, type LaneLayout } from "../../lib/lanePacking";
import { foldForSearch } from "../../lib/fuzzy";
import {
  capacityAllocationsForMode,
  dayCapacity,
  isHalfDay,
  utilizationFromCapacity,
  type DayCapacity,
} from "../../lib/capacity";
import { eachDayISO, rangesOverlap, weekdayOf } from "@capacitylens/shared/lib/dateMath";
import { effectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import type { EffectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import { effectiveProjectId, isValidISODate } from "@capacitylens/shared/lib/integrity";
import { resolveBarColor } from "@capacitylens/shared/lib/color";
import { placeholderDisplayName, timeOffTypeLabel, resourceDisplayName } from "../../lib/metadata";
import { externalBand, resourcesByDiscipline, type DisciplineGroup } from "../../store/selectors";
import { isCapacityTracked, isExternalResource } from "@capacitylens/shared/types/entities";
import { internalClientFor } from "@capacitylens/shared/data/internalClient";
import { NEUTRAL_COLOR } from "../../lib/palette";
import { laneLayout as compactLaneLayout } from "./layout";
import type { ColumnGeometry } from "./columnGeometry";
import { hasLensFilter, type Filters } from "../../store/useStore";
import type {
  Allocation,
  AppData,
  Closure,
  ID,
  InternalColourMode,
  ISODate,
  Resource,
  TimeOff,
  Weekday,
} from "@capacitylens/shared/types/entities";
import { isCreationStartBlockedForEffectiveWeek } from "./creationAvailability";
import {
  displayNameComparator,
  engagementFavouriteDisplayNameComparator,
  favouriteDisplayNameComparator,
} from "../../lib/displayOrder";

// Pure view-model builder for the scheduler: turns the dataset + window + filters
// into positioned bars, per-day capacity states, time-off blocks and utilisation,
// grouped by discipline. No React — independently unit-testable.
//
// The model OWNS the shapes the view renders (one-way data -> model -> view), so
// these live here and the presentational components import them from the model —
// not the other way round.

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

const reportedInvalidScheduleRows = new WeakSet<object>();

/** Fail visibly but once for a stable row object, then keep corrupt dates out of every scheduler path. */
function hasRenderableDateRange(row: { id: string; startDate: ISODate; endDate: ISODate }): boolean {
  const valid = isValidISODate(row.startDate) && isValidISODate(row.endDate) && row.startDate <= row.endDate;
  if (!valid && !reportedInvalidScheduleRows.has(row)) {
    reportedInvalidScheduleRows.add(row);
    console.error(`Scheduler omitted ${row.id}: invalid date range.`);
  }
  return valid;
}

// Reused for a bucket miss so a day with no allocations / no time off doesn't allocate a throwaway
// array per resource-day (this runs days × resources times on every model rebuild).
const NO_ALLOCATIONS: Allocation[] = [];
const NO_TIME_OFF: TimeOff[] = [];
const NO_CLOSURES: Closure[] = [];

/** Index of the first entry of the sorted, de-duplicated `dates` that is >= `target`
 *  (`dates.length` when every entry is earlier). Date-only ISO strings are zero-padded, so
 *  lexicographic order IS chronological order and a plain string compare is a valid ordering. */
function firstDateAtOrAfter(dates: ISODate[], target: ISODate): number {
  let lo = 0;
  let hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Bucket date-ranged rows (allocations, time off) onto the dates the model will actually ask about:
 *  each row is listed under every queried date its [startDate, endDate] covers. A per-day capacity
 *  lookup then passes only the handful of rows that touch that day instead of rescanning the
 *  resource's whole list, making the day loop O(dates + coverage) rather than O(dates × rows) — the
 *  same trick `capacityAdvisory` documents in capacity.ts. Insertion order inside each bucket follows
 *  `rows`, so the hours capacity.ts sums are added in the SAME order as a full scan and the result is
 *  bit-for-bit identical (float addition is not associative). */
function bucketByCoveredDate<T extends { startDate: ISODate; endDate: ISODate }>(
  rows: T[],
  dates: ISODate[],
): Map<ISODate, T[]> {
  const byDate = new Map<ISODate, T[]>();
  for (const row of rows) {
    for (let i = firstDateAtOrAfter(dates, row.startDate); i < dates.length; i++) {
      const date = dates[i]!;
      if (date > row.endDate) break;
      const list = byDate.get(date);
      if (list) list.push(row);
      else byDate.set(date, [row]);
    }
  }
  return byDate;
}

/** Index rows (allocations, time off) by the resource they belong to, so building a row is a Map
 *  lookup instead of a full-array scan per resource. `include` avoids an intermediate filtered
 *  array, while `visit` observes every source row before filtering. Insertion order inside each
 *  bucket follows `rows`, which the capacity sums below depend on (float addition is not
 *  associative). */
function groupByResourceId<T extends { resourceId: ID }>(
  rows: T[],
  options: {
    include?: (row: T) => boolean;
    visit?: (row: T) => void;
  } = {},
): Map<ID, T[]> {
  const byResource = new Map<ID, T[]>();
  for (const row of rows) {
    options.visit?.(row);
    if (options.include && !options.include(row)) continue;
    const list = byResource.get(row.resourceId);
    if (list) list.push(row);
    else byResource.set(row.resourceId, [row]);
  }
  return byResource;
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

/** Recompute only the visible-window percentage while retaining the expensive bar, lane and
 * timeline-day model. Horizontal scrolling changes this projection, not the static schedule. */
export function refreshVisibleUtilization(
  model: GroupModel[],
  data: AppData,
  start: ISODate,
  end: ISODate,
  accountWorkingDays: Weekday[],
  blocksMode = false,
): GroupModel[] {
  const days = eachDayISO(start, end);
  const allocations = groupByResourceId(data.allocations, { include: hasRenderableDateRange });
  const personalTimeOff = groupByResourceId(data.timeOff, { include: hasRenderableDateRange });
  const closuresByDate = bucketByCoveredDate(data.closures.filter(hasRenderableDateRange), days);
  return model.map((group) => {
    let changed = false;
    const rows = group.rows.map((row) => {
      // External / 3rd-party rows carry no capacity, so their 0 can never change (the same
      // starvation contract the build's capacity seam states).
      if (isExternalResource(row.resource)) {
        if (row.utilization === 0) return row;
        changed = true;
        return { ...row, utilization: 0 };
      }
      const resourceAllocations = capacityAllocationsForMode(allocations.get(row.resource.id) ?? [], blocksMode);
      const resourceTimeOff = personalTimeOff.get(row.resource.id) ?? [];
      const effectiveWeek = effectiveWorkingWeek(row.resource, accountWorkingDays);
      // Bucket this resource's load and time off by the days they cover ONCE, exactly as the full
      // build does, so a horizontal scroll costs O(days + coverage) per row instead of rescanning
      // every allocation on every day of the window. Bucket order follows the input, so the hours
      // are summed in the same order and the ratio is bit-identical to the rescan.
      const allocsByDate = bucketByCoveredDate(resourceAllocations, days);
      const personalTimeOffByDate = bucketByCoveredDate(resourceTimeOff, days);
      const next = utilizationFromCapacity(
        days.map((date) =>
          dayCapacity(
            row.resource,
            date,
            allocsByDate.get(date) ?? NO_ALLOCATIONS,
            personalTimeOffByDate.get(date) ?? NO_TIME_OFF,
            effectiveWeek,
            closuresByDate.get(date) ?? NO_CLOSURES,
          ),
        ),
      );
      if (next === row.utilization) return row;
      changed = true;
      return { ...row, utilization: next };
    });
    return changed ? { ...group, rows } : group;
  });
}

export function buildSchedulerModel({
  data,
  geom,
  days,
  visibleWindow: { start: visStart, end: visEnd },
  overSoonWindow: { start: overStart, end: overEnd },
  filters,
  preferences: {
    disciplinesEnabled,
    placeholdersEnabled,
    externalEnabled,
    accountWorkingDays = [1, 2, 3, 4, 5],
    groupResourcesByEngagement = true,
    blocksMode = false,
    internalColourMode = "grey",
    showInternalProjects = true,
    showInternalActivities = true,
  },
  laneLayout = compactLaneLayout,
}: SchedulerModelOptions): GroupModel[] {
  // Same diacritic-insensitive fold the fuzzy matcher uses, so typing "Jose" finds "José" whether
  // the query lands here or in a command palette.
  const search = foldForSearch(filters.search.trim());
  // ONE i18n read per build for the placeholder label: the sort below calls the display name
  // O(n log n) times and every placeholder resolves the same word. Per BUILD CALL, never module
  // scope — a Paraglide message must be called at use time so it follows the active locale.
  const placeholderLabel = placeholderDisplayName();
  const displayNameOf = (r: Resource): string => (r.kind === "placeholder" ? placeholderLabel : resourceDisplayName(r));
  const byFavouriteResourceDisplayName = favouriteDisplayNameComparator<Resource>(displayNameOf);
  const byEngagementFavouriteResourceDisplayName = engagementFavouriteDisplayNameComparator<Resource>(displayNameOf);
  const byResourceDisplayName = displayNameComparator<Resource>(displayNameOf);
  // A stale discipline filter can survive deleting the final discipline. It must not make the
  // engagement fallback look empty; only a filter that still resolves to a real discipline applies.
  const filteredDisciplineId =
    disciplinesEnabled && filters.disciplineId && data.disciplines.some((d) => d.id === filters.disciplineId)
      ? filters.disciplineId
      : null;
  const projectById = new Map(data.projects.map((p) => [p.id, p]));
  const clientById = new Map(data.clients.map((c) => [c.id, c]));
  const activityById = new Map(data.activities.map((act) => [act.id, act]));
  const resourceById = new Map(data.resources.map((r) => [r.id, r]));
  // Reused for every bar's colour (Internal-grey override, then project → client → resource → grey).
  const colorMaps = {
    activities: activityById,
    projects: projectById,
    clients: clientById,
    resources: resourceById,
    internalColourMode,
  };
  // The built-in Internal client for the data being rendered (one per account; the data here is
  // already scoped to the active account, so every client shares that accountId). A project-less
  // activity DERIVES this as its client for display + filtering — without ever writing it onto the
  // activity (no activity.clientId field). If somehow absent (a partial/legacy blob), project-less
  // activities fall back to no client. Uses the SHARED `internalClientFor` predicate (the single
  // source of truth for "the account's builtin Internal") rather than an inline flag scan, so the
  // definition can't drift from migrate/import/server. The accountId comes from the scoped data
  // itself (all rows here belong to the active account); absent any client, there's no builtin.
  const scopedAccountId = data.clients[0]?.accountId;
  const internalClient = scopedAccountId ? internalClientFor(data.clients, scopedAccountId) : undefined;
  const projectClientFor = (allocation: Allocation) => {
    const projectId = effectiveProjectId(allocation, activityById.get(allocation.activityId) ?? {});
    const project = projectId ? projectById.get(projectId) : undefined;
    // Project-less internal/repeatable work derives the built-in Internal client for display and
    // filtering only. A dangling project reference must not be mistaken for project-less work.
    const client = projectId ? (project ? clientById.get(project.clientId) : undefined) : internalClient;
    return { projectId, project, client };
  };
  // Group allocations / time off by resource ONCE up front, so building each row
  // is a Map lookup instead of a full-array scan per resource (was O(resources ×
  // (allocations + timeOff)); now O(allocations + timeOff + resources)).
  const seriesEndByKey = new Map<string, ISODate>();
  const allocsByResource = groupByResourceId(data.allocations, {
    visit: (allocation) => {
      if (!allocation.seriesId || !isValidISODate(allocation.endDate)) return;
      const key = `${allocation.accountId}\u0000${allocation.seriesId}`;
      const current = seriesEndByKey.get(key);
      if (!current || allocation.endDate > current) {
        seriesEndByKey.set(key, allocation.endDate);
      }
    },
  });
  const personalTimeOff = data.timeOff.filter(hasRenderableDateRange);
  const closures = data.closures.filter(hasRenderableDateRange);
  const timeOffByResource = groupByResourceId(personalTimeOff);

  // Does this allocation match the active project/client filter (ignoring tentative)?
  const matchesProjectClient = (a: Allocation): boolean => {
    if (!filters.projectId && !filters.clientId) return true;
    const { projectId, client } = projectClientFor(a);
    if (filters.projectId && projectId !== filters.projectId) return false;
    if (filters.clientId && client?.id !== filters.clientId) return false;
    return true;
  };
  // The activity lens (standalone — mutually exclusive with project/client via setFilters): a
  // specific internal/all-projects activity, or a whole kind ('Internal — All' / 'All projects — All').
  const matchesActivity = (a: Allocation): boolean => {
    if (filters.activityId) return a.activityId === filters.activityId;
    if (filters.activityKind) return activityById.get(a.activityId)?.kind === filters.activityKind;
    return true;
  };
  // Any "what work" filter is active — drives the dimmed / show-unmatched staffing view, which
  // is identical whether the active lens is client/project or activity.
  const workFilterActive = hasLensFilter(filters);
  const notTentativeHidden = (a: Allocation): boolean => !(filters.hideTentative && a.status === "tentative");
  const allocVisible = (a: Allocation): boolean =>
    matchesProjectClient(a) && matchesActivity(a) && notTentativeHidden(a);
  // Per-account BAR-ONLY visibility for internal work. CRITICAL PRODUCT DECISION: this filter is
  // applied ONLY when building `visibleAllocs` (bars + lane packing) — NEVER to `allAllocs`, which
  // feeds the capacity cache / utilisation below. Utilisation and capacity numbers MUST stay TRUTHFUL:
  // a person fully booked on internal work still shows as fully booked even when their internal bars
  // are hidden. Internal-project detection resolves each allocation's effective client through the
  // pre-built maps, so attributed repeatable work follows the target project's visibility.
  const barVisibleByInternalPref = (a: Allocation): boolean => {
    const activity = activityById.get(a.activityId);
    if (!activity) return true; // dangling activityId — leave to the existing safe-fallback path
    // OWNER DECISION (revised 2026-08-19): internal, unattributed all-projects and client-project
    // work are distinct groups. Attributed all-projects work displays under its client project.
    if (!showInternalActivities && activity.kind === "internal") return false;
    if (!showInternalProjects) {
      const { project, client } = projectClientFor(a);
      if (project && client?.builtin === true) return false;
    }
    return true;
  };
  const resourceVisible = (r: Resource): boolean => {
    // Placeholders are gated behind a per-account pref (default OFF). Dropping the row here is the
    // single chokepoint that also removes its bars, day-states, and utilisation contribution — the
    // resource itself is untouched in the data, so this is a hide, not a delete. A placeholder's
    // allocations simply go unreferenced (the model is built resource-first via allocsByResource).
    if (!placeholdersEnabled && r.kind === "placeholder") return false;
    // External / 3rd parties are gated behind their own per-account pref (default OFF), exactly
    // like placeholders. Dropping the row here empties the external band; the trailing
    // `rows.length > 0` filter then removes the band group so no empty header is drawn (risk #2).
    if (!externalEnabled && isExternalResource(r)) return false;
    if (filteredDisciplineId && r.disciplineId !== filteredDisciplineId) return false;
    // Search the DISPLAY name too, so a placeholder (shown as "Placeholder") is findable by what the
    // user sees — matching the command palette — as well as by its underlying role/name. Folding is
    // per-resource string work, so it runs only when there is actually a query to match.
    if (search) {
      const resourceSearchFields = [resourceDisplayName(r), r.name, r.role].map((field) => foldForSearch(field ?? ""));
      if (!resourceSearchFields.some((field) => field.includes(search))) return false;
    }
    return true;
  };

  // The [visStart, visEnd] and [overStart, overEnd] windows are RESOURCE-INVARIANT — every row in
  // this model reads the exact same two windows. Building their day arrays here ONCE avoids resources
  // × (visibleDays + 14) redundant eachDayISO calls per model rebuild (this fires on every scroll-day
  // change, zoom, filter keystroke and edit). Each row separately caches its computed resource-day
  // results below, so dates shared by the timeline, visible window and fixed overSoon window scan
  // that resource's allocations/time off only once. Not sliced from `days`: `days` covers the
  // SCROLLABLE timeline, while overStart/overEnd
  // is a FIXED window anchored on today that can fall outside it (and visStart/visEnd, though always
  // within `days` in practice, isn't worth a fragile index-based slice to save one extra pair of calls).
  const visDays = eachDayISO(visStart, visEnd);
  const overDays = eachDayISO(overStart, overEnd);
  // Every per-day capacity lookup below asks for a date drawn from one of those three arrays, so
  // their sorted, de-duplicated union is the COMPLETE set of dates any row can query. Bucketing a
  // resource's allocations / time off onto it once (see bucketByCoveredDate) is what turns the
  // per-row day loop from O(days × allocations) into O(days + coverage). Resource-invariant, so it
  // is built here once rather than per row. ISO dates sort lexicographically = chronologically.
  const capacityDates = Array.from(new Set([...days, ...visDays, ...overDays])).sort();
  const capacityDateSet = new Set(capacityDates);
  const closuresByDate = bucketByCoveredDate(closures, capacityDates);

  const timelineStart = days[0];
  const timelineEnd = days[days.length - 1];
  const intersectsTimeline = (row: { startDate: ISODate; endDate: ISODate }) =>
    timelineStart !== undefined &&
    timelineEnd !== undefined &&
    rangesOverlap(row.startDate, row.endDate, timelineStart, timelineEnd);

  const timeOffBlockFor = (t: TimeOff): TimeOffBlock => ({
    id: t.id,
    x: geom.xForDateInGeom(t.startDate),
    width: geom.widthForDates(t.startDate, t.endDate),
    label: timeOffTypeLabel(t.type),
    note: t.note,
  });
  const NO_TIME_OFF_BLOCKS: TimeOffBlock[] = [];

  /** A row's capacity view of its own data. External / 3rd-party rows have NO capacity: no
   *  over-markers, no utilisation, no time-off blocks — an awareness band, not a bookable lane. That
   *  STARVATION CONTRACT lives HERE, as capacity-free outputs behind the same shape the tracked path
   *  fills, so the day loop below has one arm instead of two that have to be kept in step. `tracked`
   *  is the flag that keeps a starved row's zero `available` from reading as "fully booked" — only a
   *  genuinely tracked resource can be made unavailable by its own capacity. */
  interface CapacitySource {
    tracked: boolean;
    /** The row's applicable personal time off covering one date. */
    timeOffOn: (date: ISODate) => TimeOff[];
    capacityOnDay: (date: ISODate) => DayCapacity;
    allocationCountOn: (date: ISODate) => number;
    timeOffCountOn: (date: ISODate) => number;
    utilizationOver: (dates: ISODate[]) => number;
    overOn: (dates: ISODate[]) => boolean;
  }
  const NO_CAPACITY = (date: ISODate): DayCapacity => ({ date, allocated: 0, available: 0, over: false });
  const capacitySourceFor = (
    resource: Resource,
    allocations: Allocation[],
    resTimeOff: TimeOff[],
    effectiveWeek: EffectiveWorkingWeek,
  ): CapacitySource => {
    if (isExternalResource(resource)) {
      return {
        tracked: false,
        timeOffOn: () => NO_TIME_OFF,
        capacityOnDay: NO_CAPACITY,
        allocationCountOn: () => 0,
        timeOffCountOn: () => 0,
        utilizationOver: () => 0,
        overOn: () => false,
      };
    }
    // Capacity reflects ALL the resource's allocations (truthful load), not the filtered view.
    const capacityAllocs = capacityAllocationsForMode(allocations, blocksMode);
    const rowTimeOff = resTimeOff;
    // Bucket this resource's load and time off by the days they cover, ONCE, so each of the
    // ~150 timeline days hands capacity.ts only the rows that actually touch that day instead
    // of making it rescan every allocation (and every time-off row) per day.
    const allocsByDate = bucketByCoveredDate(capacityAllocs, capacityDates);
    const personalTimeOffByDate = bucketByCoveredDate(resTimeOff, capacityDates);
    const capacityByDate = new Map<ISODate, DayCapacity>();
    const capacityOnDay = (date: ISODate): DayCapacity => {
      const cached = capacityByDate.get(date);
      if (cached) return cached;
      // A date outside `capacityDates` has no bucket to read (an empty bucket and "not
      // bucketed" are indistinguishable), so fall back to the full lists. Nothing queries
      // such a date today; this keeps a future caller correct rather than silently empty.
      const computed = capacityDateSet.has(date)
        ? dayCapacity(
            resource,
            date,
            allocsByDate.get(date) ?? NO_ALLOCATIONS,
            personalTimeOffByDate.get(date) ?? NO_TIME_OFF,
            effectiveWeek,
            closuresByDate.get(date) ?? NO_CLOSURES,
          )
        : dayCapacity(resource, date, capacityAllocs, rowTimeOff, effectiveWeek, closures);
      capacityByDate.set(date, computed);
      return computed;
    };
    const timeOffOn = (date: ISODate) =>
      capacityDateSet.has(date) ? (personalTimeOffByDate.get(date) ?? NO_TIME_OFF) : rowTimeOff;
    return {
      tracked: true,
      timeOffOn,
      capacityOnDay,
      allocationCountOn: (date) => allocsByDate.get(date)?.length ?? 0,
      timeOffCountOn: (date) =>
        timeOffOn(date).length +
        (capacityDateSet.has(date)
          ? (closuresByDate.get(date)?.length ?? 0)
          : closures.filter((closure) => closure.startDate <= date && closure.endDate >= date).length),
      utilizationOver: (dates) => utilizationFromCapacity(dates.map(capacityOnDay)),
      overOn: (dates) => dates.some((date) => capacityOnDay(date).over),
    };
  };

  interface SchedulerResourceGroup extends DisciplineGroup {
    key: string;
    title: string;
    color?: string;
  }
  const fallbackGroups = (resources: Resource[]): SchedulerResourceGroup[] => {
    if (!groupResourcesByEngagement) {
      return resources.length ? [{ key: "unassigned", title: "Unassigned", discipline: null, resources }] : [];
    }
    return [
      {
        key: "engagement-studio",
        title: "Studio",
        discipline: null,
        resources: resources.filter((resource) => resource.engagement === "studio"),
      },
      {
        key: "engagement-supplementary",
        title: "Supplementary",
        discipline: null,
        resources: resources.filter((resource) => resource.engagement === "supplementary"),
      },
    ].filter((group) => group.resources.length > 0);
  };

  // Assigned resources retain canonical discipline order. Every unassigned capacity-tracked row
  // then receives a useful engagement home; with disciplines off, that fallback becomes the whole
  // capacity grouping. External / 3rd party is deliberately appended last in both modes.
  const groups: SchedulerResourceGroup[] = [];
  if (disciplinesEnabled) {
    const disciplineGroups = resourcesByDiscipline(data);
    for (const group of disciplineGroups) {
      if (group.discipline) {
        groups.push({
          ...group,
          key: group.discipline.id,
          title: group.discipline.name,
          color: group.discipline.color,
        });
      }
    }
    const unassigned = disciplineGroups.find((group) => !group.discipline && !group.external)?.resources ?? [];
    groups.push(...fallbackGroups(unassigned));
  } else {
    groups.push(...fallbackGroups(data.resources.filter(isCapacityTracked)));
  }
  const external = externalBand(data.resources);
  if (external) {
    groups.push({
      ...external,
      key: "external",
      title: "External / 3rd party",
      color: NEUTRAL_COLOR,
    });
  }
  return groups
    .map((group) => ({
      key: group.key,
      title: group.title,
      color: group.color,
      external: !!group.external,
      // Keep discipline/external grouping intact. People are Studio then Supplementary when the
      // default-on account preference is enabled, with favourites first alphabetically inside each
      // partition. Placeholders remain after all people and have no favourite affordance.
      rows: group.resources
        .filter(resourceVisible)
        .sort(
          (a, b) =>
            Number(a.kind === "placeholder") - Number(b.kind === "placeholder") ||
            (a.kind === "placeholder"
              ? byResourceDisplayName(a, b)
              : groupResourcesByEngagement
                ? byEngagementFavouriteResourceDisplayName(a, b)
                : byFavouriteResourceDisplayName(a, b)),
        )
        .map((resource) => {
          // This resource's data, pre-grouped above; capacity then scans only its own
          // allocations/time-off, not the whole dataset per day (was O(res×days×allocs)).
          const allAllocs = (allocsByResource.get(resource.id) ?? []).filter(hasRenderableDateRange);
          const resTimeOff = timeOffByResource.get(resource.id) ?? [];
          const isExternal = isExternalResource(resource);
          // Resolve the company/personal intersection once for the whole row. Capacity, creation
          // blocking, visible utilisation and overSoon all reuse this discriminated result.
          const effectiveWeek = effectiveWorkingWeek(resource, accountWorkingDays);
          // A row is "dimmed" when a work filter (client/project OR the activity lens) is active and
          // this resource has NO MATCHING BAR in the displayed timeline — we still show their full
          // real load (so you can see who's free to staff), just visually de-emphasised. Deriving this
          // from the exact matching bar set means off-timeline and otherwise hidden matches cannot
          // create a full-opacity, zero-bar "ghost" row that escapes the show-unmatched filter.
          const matchingVisibleAllocs = allAllocs
            .filter(allocVisible)
            .filter(intersectsTimeline)
            .filter(barVisibleByInternalPref);
          const dimmed = workFilterActive && matchingVisibleAllocs.length === 0;
          const visibleAllocs = dimmed
            ? allAllocs
                .filter(notTentativeHidden)
                .filter(intersectsTimeline)
                // BAR-ONLY internal-work hide (see barVisibleByInternalPref). Applied here, after the
                // capacity path has already taken `allAllocs`, so hiding an internal bar never changes
                // the resource's utilisation/capacity — only which bars render.
                .filter(barVisibleByInternalPref)
            : matchingVisibleAllocs;
          const { lanes, laneCount } = packLanes(visibleAllocs);
          const laneById = new Map(lanes.map((l) => [l.id, l.lane]));
          const bars: BarLayout[] = visibleAllocs.map((a) => {
            const { project, client } = projectClientFor(a);
            return {
              allocation: a,
              x: geom.xForDateInGeom(a.startDate),
              width: geom.widthForDates(a.startDate, a.endDate),
              top: laneTop(laneById.get(a.id) ?? 0, laneLayout),
              color: resolveBarColor(a, colorMaps),
              label: activityById.get(a.activityId)?.name ?? "Activity",
              project: project?.name,
              client: client?.name,
              seriesEnd: a.seriesId ? seriesEndByKey.get(`${a.accountId}\u0000${a.seriesId}`) : undefined,
              external: isExternal,
            };
          });
          const capacity = capacitySourceFor(resource, allAllocs, resTimeOff, effectiveWeek);
          const dayStates: DayState[] = [];
          let conflictDayCount = 0;
          let partialCapacityDayCount = 0;
          for (const date of days) {
            const cap = capacity.capacityOnDay(date);
            // Company-closed dates still receive the shared unavailable tint on EVERY row, starved
            // or not, because allocation creation is blocked there for everyone. The per-date
            // bucket keeps this O(coverage) instead of rescanning the full row list each day.
            const creationBlocked = isCreationStartBlockedForEffectiveWeek(
              resource,
              date,
              capacity.timeOffOn(date),
              effectiveWeek,
              data.closures,
            );
            const unavailable = (capacity.tracked && cap.available === 0) || creationBlocked;
            const partialCapacity = capacity.tracked && !unavailable && isHalfDay(resource, weekdayOf(date));
            const hasTimeOff = capacity.timeOffCountOn(date) > 0;
            // Blocks carry placement but zero hourly load. Their date-range overlap with time
            // off is therefore an explicit conflict signal rather than fabricated capacity.
            // Hours/Days retain their existing working-day-aware `cap.over` semantics.
            const timeOffConflict = hasTimeOff && (blocksMode ? capacity.allocationCountOn(date) > 0 : cap.over);
            if (cap.over || timeOffConflict) conflictDayCount++;
            if (partialCapacity) partialCapacityDayCount++;
            dayStates.push({
              over: cap.over,
              timeOffConflict,
              unavailable,
              partialCapacity,
              creationBlocked,
              hasTimeOff,
            });
          }
          // Starved rows draw no blocks (see CapacitySource); tracked rows share the company
          // array and reuse one side untouched when the other is empty, same as mergeTimeOff.
          const personalTimeOffBlocks = resTimeOff.filter(intersectsTimeline).map(timeOffBlockFor);
          const timeOff: TimeOffBlock[] = capacity.tracked ? personalTimeOffBlocks : NO_TIME_OFF_BLOCKS;
          // The DISPLAYED utilisation % runs over the VISIBLE window [visStart, visEnd]; the
          // `overSoon` red flag runs over the FIXED forward window [overStart, overEnd] — two
          // deliberately separate signals (see the param doc above). Utilisation ignores zero-capacity
          // days in its denominator; overSoon follows the strict per-day allocated > available rule, so
          // a time-off day or an opted-in weekend can trip it while a merely-spanned weekend still cannot
          // (weekend-aware allocated hours are zero). Starved rows answer 0 / never over.
          const utilization = capacity.utilizationOver(visDays);
          const overSoon = capacity.overOn(overDays);
          return {
            resource,
            rowHeight: rowHeightForLanes(laneCount, laneLayout),
            bars,
            dayStates,
            conflictDayCount,
            partialCapacityDayCount,
            timeOff,
            utilization,
            overSoon,
            dimmed,
          };
        })
        // Non-matching rows are hidden by default; the "Show unallocated" toggle opts
        // the dimmed staffing view back in.
        .filter((row) => filters.showUnmatched || !row.dimmed),
    }))
    .filter((g) => g.rows.length > 0);
}
