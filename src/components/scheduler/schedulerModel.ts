import { laneTop, packLanes, rowHeightForLanes, type LaneLayout } from "../../lib/lanePacking";
import {
  capacityAllocationsForMode,
  dayCapacity,
  overAllocatedInWindow,
  utilizationFromCapacity,
  type DayCapacity,
} from "../../lib/capacity";
import { eachDayISO } from "@capacitylens/shared/lib/dateMath";
import { isValidISODate } from "@capacitylens/shared/lib/integrity";
import { resolveBarColor } from "@capacitylens/shared/lib/color";
import { timeOffTypeLabels, resourceDisplayName } from "../../lib/metadata";
import { externalBand, resourcesByDiscipline, type DisciplineGroup } from "../../store/selectors";
import { isCapacityTracked, isExternalResource } from "@capacitylens/shared/types/entities";
import { internalClientFor } from "@capacitylens/shared/data/internalClient";
import { NEUTRAL_COLOR } from "../../lib/palette";
import { laneLayout as compactLaneLayout } from "./layout";
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
import { isCreationStartBlocked } from "./creationAvailability";
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
const byFavouriteResourceDisplayName = favouriteDisplayNameComparator<Resource>(resourceDisplayName);
const byEngagementFavouriteResourceDisplayName =
  engagementFavouriteDisplayNameComparator<Resource>(resourceDisplayName);
const byResourceDisplayName = displayNameComparator<Resource>(resourceDisplayName);

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

/** Per-day capacity state for a lane background cell. */
export interface DayState {
  over: boolean;
  unavailable: boolean;
  creationBlocked?: boolean;
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
  timeOff: TimeOffBlock[];
  utilization: number; // working-day ratio over the VISIBLE window [visStart, visEnd]
  overSoon: boolean; // over-allocated on >=1 working day inside the FIXED forward window [overStart, overEnd]
  dimmed: boolean; // no work on the active project/client filter — shown for staffing context
}

export interface GroupModel {
  key: string;
  title: string;
  color?: string;
  /** True for the external / 3rd-party band. The view reads THIS (not the key string) to keep the
   *  band's header in flat mode and to suppress its utilisation average. */
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
  // The per-day over-marker (dayStates.over) is a THIRD, distinct signal — it flags any day where
  // allocated > available (the over / red-background signal) across the whole `days` timeline. Its
  // `allocated` is weekend-aware (a bar merely spanning Sat/Sun does no weekend work), so the only
  // zero-capacity days it catches are a TIME-OFF day a working allocation covers and a weekend an
  // allocation opts into via `ignoreWeekends`.
  visibleWindow: { start: ISODate; end: ISODate };
  overSoonWindow: { start: ISODate; end: ISODate };
  filters: Filters;
  preferences: {
    // When false (account.disciplinesEnabled === false) the schedule renders FLAT: one
    // synthetic group holding every resource (no discipline bands), and the discipline
    // filter is ignored. SchedulerGrid skips the group-header row for the flat group.
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
    /** Default-on company preference: Studio then Supplementary, favourites first within each. */
    groupResourcesByEngagement?: boolean;
    blocksMode?: boolean;
    // Per-account Internal-work display preference. Grey is the absent/default mode; palette mode
    // restores the normal project/resource colour path without changing persisted entity colours.
    internalColourMode?: InternalColourMode;
    // Per-account BAR-ONLY view prefs (both default ON). When false they hide, from the schedule bars
    // ONLY, allocations on internal PROJECTS (activity kind 'project' whose project's client is the
    // built-in Internal client) / internal ACTIVITIES (kind 'internal' ONLY — cross-project
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
  blocksMode = false,
): GroupModel[] {
  const days = eachDayISO(start, end);
  const byResource = <T extends { id: ID; resourceId: ID; startDate: ISODate; endDate: ISODate }>(rows: T[]) => {
    const grouped = new Map<ID, T[]>();
    for (const row of rows) {
      if (!hasRenderableDateRange(row)) continue;
      const list = grouped.get(row.resourceId);
      if (list) list.push(row);
      else grouped.set(row.resourceId, [row]);
    }
    return grouped;
  };
  const allocations = byResource(data.allocations);
  const timeOff = byResource(data.timeOff);
  return model.map((group) => {
    let changed = false;
    const rows = group.rows.map((row) => {
      const resourceAllocations = capacityAllocationsForMode(allocations.get(row.resource.id) ?? [], blocksMode);
      const resourceTimeOff = timeOff.get(row.resource.id) ?? [];
      const next = isExternalResource(row.resource)
        ? 0
        : utilizationFromCapacity(
            days.map((date) => dayCapacity(row.resource, date, resourceAllocations, resourceTimeOff)),
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
  const searchable = (value: string | undefined): string =>
    (value ?? "")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLocaleLowerCase();
  const search = searchable(filters.search.trim());
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
  const activityMeta = new Map(
    data.activities.map((act) => {
      // A project-specific activity's client is its project's client. A project-less internal/cross-project
      // activity has NO project, so its client is DERIVED as the account's built-in Internal client
      // (purely for the view-model — never persisted). `kind` feeds the activity lens
      // ('Internal — All' / 'Cross-project — All') without a second activity lookup.
      const project = act.projectId ? projectById.get(act.projectId) : undefined;
      const clientId = act.projectId ? project?.clientId : internalClient?.id;
      return [act.id, { projectId: act.projectId, clientId, kind: act.kind }];
    }),
  );
  // Group allocations / time off by resource ONCE up front, so building each row
  // is a Map lookup instead of a full-array scan per resource (was O(resources ×
  // (allocations + timeOff)); now O(allocations + timeOff + resources)).
  const allocsByResource = new Map<ID, Allocation[]>();
  for (const a of data.allocations) {
    const list = allocsByResource.get(a.resourceId);
    if (list) list.push(a);
    else allocsByResource.set(a.resourceId, [a]);
  }
  const timeOffByResource = new Map<ID, TimeOff[]>();
  for (const t of data.timeOff) {
    const list = timeOffByResource.get(t.resourceId);
    if (list) list.push(t);
    else timeOffByResource.set(t.resourceId, [t]);
  }

  const projectClientActive = !!(filters.projectId || filters.clientId);
  // Does this allocation match the active project/client filter (ignoring tentative)?
  const matchesProjectClient = (a: Allocation): boolean => {
    const meta = activityMeta.get(a.activityId);
    if (filters.projectId && meta?.projectId !== filters.projectId) return false;
    if (filters.clientId && meta?.clientId !== filters.clientId) return false;
    return true;
  };
  // The activity lens (standalone — mutually exclusive with project/client via setFilters): a
  // specific internal/cross-project activity, or a whole kind ('Internal — All' / 'Cross-project — All').
  const activityFilterActive = !!(filters.activityId || filters.activityKind);
  const matchesActivity = (a: Allocation): boolean => {
    if (filters.activityId) return a.activityId === filters.activityId;
    if (filters.activityKind) return activityMeta.get(a.activityId)?.kind === filters.activityKind;
    return true;
  };
  // Any "what work" filter is active — drives the dimmed / show-unmatched staffing view, which
  // is identical whether the active lens is client/project or activity.
  const workFilterActive = projectClientActive || activityFilterActive;
  const notTentativeHidden = (a: Allocation): boolean => !(filters.hideTentative && a.status === "tentative");
  const allocVisible = (a: Allocation): boolean =>
    matchesProjectClient(a) && matchesActivity(a) && notTentativeHidden(a);
  // Per-account BAR-ONLY visibility for internal work. CRITICAL PRODUCT DECISION: this filter is
  // applied ONLY when building `visibleAllocs` (bars + lane packing) — NEVER to `allAllocs`, which
  // feeds the capacity cache / utilisation below. Utilisation and capacity numbers MUST stay TRUTHFUL:
  // a person fully booked on internal work still shows as fully booked even when their internal bars
  // are hidden. Internal-project detection uses the pre-built maps (no extra scans): a 'project'
  // activity → its project's client (via activityMeta.clientId) → `builtin === true`.
  const barVisibleByInternalPref = (a: Allocation): boolean => {
    const activity = activityById.get(a.activityId);
    if (!activity) return true; // dangling activityId — leave to the existing safe-fallback path
    // OWNER DECISION (2026-07-22): internal, cross-project and client-project work are three
    // DISTINCT groups — this toggle hides only kind 'internal'. Cross-project ('repeatable')
    // bars stay visible even though they display under the derived Internal client label.
    if (!showInternalActivities && activity.kind === "internal") return false;
    if (!showInternalProjects && activity.kind === "project") {
      const clientId = activityMeta.get(a.activityId)?.clientId;
      if (clientId !== undefined && clientById.get(clientId)?.builtin === true) return false;
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
    if (disciplinesEnabled && filters.disciplineId && r.disciplineId !== filters.disciplineId) return false;
    // Search the DISPLAY name too, so a placeholder (shown as "Placeholder") is findable by what the
    // user sees — matching the command palette — as well as by its underlying role/name.
    const resourceSearchFields = [resourceDisplayName(r), r.name, r.role].map(searchable);
    if (search && !resourceSearchFields.some((field) => field.includes(search))) return false;
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

  const timelineStart = days[0];
  const timelineEnd = days[days.length - 1];
  const intersectsTimeline = (row: { startDate: ISODate; endDate: ISODate }) =>
    timelineStart !== undefined &&
    timelineEnd !== undefined &&
    row.endDate >= timelineStart &&
    row.startDate <= timelineEnd;

  // Disciplines on → group by discipline (ungrouped bucket, then the external band, last). Off →
  // one flat group of every NON-external resource, with the external band STILL trailing (the band
  // is required regardless of disciplines on/off). SchedulerGrid renders the flat group without a
  // header but still draws the external band's header. Build the flat groups LAZILY so the common
  // disciplines-on path doesn't scan resources for a value it discards.
  const groups = disciplinesEnabled
    ? resourcesByDiscipline(data)
    : (() => {
        const flat: DisciplineGroup[] = [
          {
            discipline: null,
            resources: data.resources.filter(isCapacityTracked),
          },
        ];
        const band = externalBand(data.resources);
        if (band) flat.push(band);
        return flat;
      })();
  return groups
    .map((group) => ({
      key: group.external ? "external" : (group.discipline?.id ?? "none"),
      title: group.external ? "External / 3rd party" : (group.discipline?.name ?? "No discipline"),
      color: group.external ? NEUTRAL_COLOR : group.discipline?.color,
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
          const resTimeOff = (timeOffByResource.get(resource.id) ?? []).filter(hasRenderableDateRange);
          // External / 3rd-party rows have NO capacity: no over-markers, no utilisation, no time-off
          // — an awareness band, not a bookable lane. We starve the capacity path rather than
          // special-case the (dumb) lane; their activity bars still render.
          const isExternal = isExternalResource(resource);
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
            const meta = activityMeta.get(a.activityId);
            const project = meta?.projectId ? projectById.get(meta.projectId) : undefined;
            const client = meta?.clientId ? clientById.get(meta.clientId) : undefined;
            return {
              allocation: a,
              x: geom.xForDateInGeom(a.startDate),
              width: geom.widthForDates(a.startDate, a.endDate),
              top: laneTop(laneById.get(a.id) ?? 0, laneLayout),
              color: resolveBarColor(a, colorMaps),
              label: activityById.get(a.activityId)?.name ?? "Activity",
              project: project?.name,
              client: client?.name,
              external: isExternal,
            };
          });
          // Capacity reflects ALL the resource's allocations (truthful load), not the filtered view.
          // External rows carry none and have no time-off blocks; company-closed dates still receive
          // the shared unavailable tint because allocation creation is blocked there for every row.
          const capacityAllocs = capacityAllocationsForMode(allAllocs, blocksMode);
          // Bucket this resource's load and time off by the days they cover, ONCE, so each of the
          // ~150 timeline days hands capacity.ts only the rows that actually touch that day instead
          // of making it rescan every allocation (and every time-off row) per day. External rows
          // never reach capacityOnDay, so they skip the bucketing entirely.
          const allocsByDate = isExternal ? undefined : bucketByCoveredDate(capacityAllocs, capacityDates);
          const timeOffByDate = isExternal ? undefined : bucketByCoveredDate(resTimeOff, capacityDates);
          const capacityByDate = new Map<ISODate, DayCapacity>();
          const capacityOnDay = (date: ISODate): DayCapacity => {
            const cached = capacityByDate.get(date);
            if (cached) return cached;
            // A date outside `capacityDates` has no bucket to read (an empty bucket and "not
            // bucketed" are indistinguishable), so fall back to the full lists. Nothing queries
            // such a date today; this keeps a future caller correct rather than silently empty.
            const bucketed = allocsByDate !== undefined && capacityDateSet.has(date);
            const computed = bucketed
              ? dayCapacity(
                  resource,
                  date,
                  allocsByDate.get(date) ?? NO_ALLOCATIONS,
                  timeOffByDate?.get(date) ?? NO_TIME_OFF,
                )
              : dayCapacity(resource, date, capacityAllocs, resTimeOff);
            capacityByDate.set(date, computed);
            return computed;
          };
          const dayStates: DayState[] = isExternal
            ? days.map((date) => {
                const creationBlocked = isCreationStartBlocked(resource, date, [], accountWorkingDays);
                return { over: false, unavailable: creationBlocked, creationBlocked };
              })
            : days.map((d) => {
                const cap = capacityOnDay(d);
                const creationBlocked = isCreationStartBlocked(resource, d, resTimeOff, accountWorkingDays);
                return {
                  over: cap.over,
                  unavailable: cap.available === 0 || creationBlocked,
                  creationBlocked,
                };
              });
          const timeOff: TimeOffBlock[] = isExternal
            ? []
            : resTimeOff.filter(intersectsTimeline).map((t) => ({
                id: t.id,
                x: geom.xForDateInGeom(t.startDate),
                width: geom.widthForDates(t.startDate, t.endDate),
                label: timeOffTypeLabels()[t.type],
                note: t.note,
              }));
          // The DISPLAYED utilisation % runs over the VISIBLE window [visStart, visEnd]; the
          // `overSoon` red flag runs over the FIXED forward window [overStart, overEnd] — two
          // deliberately separate signals (see the param doc above). Utilisation ignores zero-capacity
          // days in its denominator; overSoon follows the strict per-day allocated > available rule, so
          // a time-off day or an opted-in weekend can trip it while a merely-spanned weekend still cannot
          // (weekend-aware allocated hours are zero). External rows remain utilisation 0 and never over.
          const utilization = isExternal ? 0 : utilizationFromCapacity(visDays.map(capacityOnDay));
          const overSoon =
            !isExternal &&
            overAllocatedInWindow(
              resource,
              capacityAllocs,
              resTimeOff,
              overStart,
              overEnd,
              overDays.map(capacityOnDay),
            );
          return {
            resource,
            rowHeight: rowHeightForLanes(laneCount, laneLayout),
            bars,
            dayStates,
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
