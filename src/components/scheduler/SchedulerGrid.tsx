import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronRight, Plus, SlidersHorizontal, Users } from "lucide-react";
import { m } from "@/i18n";
import { formatUtilizationPercent } from "../../lib/utilizationPercent";
import { hasActiveFilters, useStore } from "../../store/useStore";
import { useCanEdit } from "../../auth/permissionContext";
import { useActiveScopedData } from "../../store/useScopedData";
import {
  disciplinesEnabledFor,
  externalEnabledFor,
  groupResourcesByEngagementFor,
  internalColourModeFor,
  placeholdersEnabledFor,
  schedulingModeFor,
  showInternalActivitiesFor,
  showInternalProjectsFor,
  timeZoneFor,
  weekStartsOnFor,
  accountWorkingDaysFor,
} from "../../store/selectors";
import { defaultAccountWorkingDays, normalizeAccountWorkingDays } from "@capacitylens/shared/lib/accountWorkingDays";
import { addDaysISO } from "@capacitylens/shared/lib/dateMath";
import { UTILIZATION_WINDOW_DAYS } from "../../lib/schedulerConfig";
import { Avatar, EmptyState } from "../common/ui";
import { resourceDisplayName } from "../../lib/metadata";
import { LAYOUT, laneLayoutFor, schedulerDensity } from "./layout";
import { DateHeader } from "./DateHeader";
import { ResourceLane } from "./ResourceLane";
import { buildSchedulerModel, refreshVisibleUtilization } from "./schedulerModel";
import { rowScreenReaderSummary } from "./rowSummary";
import { buildLayout, windowFromLayout } from "./virtualWindow";
import { useSchedulerViewport } from "./useSchedulerViewport";
import type { GroupModel, RowModel } from "./schedulerModel";
import {
  carriesHourlyLoad,
  emptyAppData,
  isCapacityTracked,
  isExternalResource,
} from "@capacitylens/shared/types/entities";
import type { ID, ISODate } from "@capacitylens/shared/types/entities";
import { Button } from "../ui/button";
import { TooltipProvider } from "../ui/tooltip";
import { useCalendarToday } from "./useCalendarToday";
import { visibleSpanLabels, visibleWindowFor } from "./visibleSpan";
import { isCreationStartBlocked } from "./creationAvailability";
import { ClosureBand } from "./ClosureBand";

// Creation/editing forms are not needed to paint or inspect the schedule. Load them on the first
// interaction so their validation and picker dependencies do not consume the initial entry budget.
const AllocationModal = lazy(() =>
  import("./AllocationModal").then((module) => ({
    default: module.AllocationModal,
  })),
);
const TimeOffForm = lazy(() =>
  import("../timeoff/TimeOffForm").then((module) => ({
    default: module.TimeOffForm,
  })),
);

/** The mean of the rows' visible-window utilisation, formatted for display — "0" for no rows.
 *  Shared by the headline and per-group figures, which select their rows DIFFERENTLY (see the
 *  call sites); only the arithmetic and formatting are common. */
function averageUtilizationPercent(rows: RowModel[]): string {
  return rows.length ? formatUtilizationPercent(rows.reduce((sum, r) => sum + r.utilization, 0) / rows.length) : "0";
}

type ModalState =
  | { kind: "edit"; allocationId: ID }
  | { kind: "create"; resourceId: ID; startDate: ISODate; endDate: ISODate }
  | { kind: "timeoff"; resourceId: ID; startDate: ISODate; endDate: ISODate };

/**
 * The week-grid scheduler: the helicopter view of who's busy/free. Two non-obvious
 * mechanisms run here — read this before touching the scroll/render path.
 *
 * **1. Vertical virtualization.** The model (groups → rows) is flattened into one ordered
 * `items` list (group headers + the rows of expanded groups), then each item's height is
 * measured (`heights`), prefix-summed by `buildLayout`, and `windowFromLayout` picks the
 * on-screen slice (`{first, last}`) for the current `scrollTop`/viewport height. Only that slice
 * is in the DOM; the vertical space of every skipped item is RESERVED by an aria-hidden spacer
 * div sized to the gap between consecutive rendered items, so the scrollbar geometry stays
 * correct (drop the spacers and the scroll height collapses, so the thumb and every offset would
 * be wrong). `heights`/`layout` are memoised on the item set, so a scroll frame only runs the
 * cheap edge-scan, not a full re-measure.
 *
 * **2. Drag pinning.** Vertical windowing continues to follow scrolling during a drag so newly
 * visible rows become drop targets. If the source row leaves that window, it is rendered as one
 * additional disjoint item at its real layout offset; this keeps the AllocationBar's document
 * pointer listeners mounted without rendering every intervening row. Horizontal date geometry
 * remains frozen until the gesture ends.
 */
export function SchedulerGrid() {
  const navigate = useNavigate();
  const data = useActiveScopedData();
  const activeAccount = useStore((state) =>
    state.data.accounts.find((account) => account.id === state.activeAccountId),
  );
  // Every per-account view pref this grid reads, resolved from the ONE `activeAccount` row above
  // instead of a separate store subscription each. They all look up the same account, so ten
  // selector subscriptions meant ten `accounts.find` scans on every unrelated store write. The
  // selectors still OWN their absent-field defaults (each differs and is load-bearing), so they
  // are called here against a one-account view of the data rather than reimplemented.
  const accountPrefs = useMemo(() => {
    const view = { ...emptyAppData(), accounts: activeAccount ? [activeAccount] : [] };
    const id = activeAccount?.id ?? null;
    return {
      // Default OFF: when off, placeholder ("slot") rows are hidden from the schedule (and dropped
      // from utilisation) by buildSchedulerModel's resourceVisible filter.
      placeholdersEnabled: placeholdersEnabledFor(view, id),
      // Default OFF: when off, external / 3rd-party rows are hidden from the schedule (and their
      // now-empty band header is dropped) by the same resourceVisible filter.
      externalEnabled: externalEnabledFor(view, id),
      // When disciplines are off, discipline bands disappear and the model uses the
      // Studio/Supplementary (or Unassigned) fallback. The discipline filter is ignored.
      disciplinesEnabled: disciplinesEnabledFor(view, id),
      groupResourcesByEngagement: groupResourcesByEngagementFor(view, id),
      // Internal work colour preference. Grey is the absent/default mode; palette restores saved
      // project colours without changing the underlying project records.
      internalColourMode: internalColourModeFor(view, id),
      // BAR-ONLY hide prefs for internal work (both default ON). They remove only the bars —
      // capacity/utilisation stay truthful (see buildSchedulerModel's barVisibleByInternalPref).
      showInternalProjects: showInternalProjectsFor(view, id),
      showInternalActivities: showInternalActivitiesFor(view, id),
      blocksMode: !carriesHourlyLoad(schedulingModeFor(view, id)),
      calendarTimeZone: timeZoneFor(view, id),
      calendarWeekStartsOn: weekStartsOnFor(view, id),
    };
  }, [activeAccount]);
  const {
    placeholdersEnabled,
    externalEnabled,
    disciplinesEnabled,
    groupResourcesByEngagement,
    internalColourMode,
    showInternalProjects,
    showInternalActivities,
    blocksMode,
    calendarTimeZone,
    calendarWeekStartsOn,
  } = accountPrefs;
  const accountWorkingDays = useMemo(() => {
    const weekStartsOn = activeAccount?.weekStartsOn ?? 1;
    return activeAccount?.workingDays === undefined
      ? defaultAccountWorkingDays(weekStartsOn)
      : normalizeAccountWorkingDays(activeAccount.workingDays, weekStartsOn);
  }, [activeAccount]);
  // Viewer read-only (P1.12): when the active account's role is a viewer, the grid is display-only —
  // no row "+" create, no lane draw-to-create, no bar edit/drag/resize (the bar gating lives in
  // AllocationBar; the draw/create gating is the conditional onDraw/onEdit + the hidden "+" below).
  // null/owner/admin/editor (incl. OFF/local) → fully editable, byte-identical to today. The server
  // 403 backstops a write regardless; this is the UX read-only surface.
  const canEdit = useCanEdit();
  const ui = useStore((s) => s.ui);
  // Utilisation display toggles (Settings → Utilisation). Each gates one of the three
  // utilisation figures: total (header), discipline (group header), personal (per row).
  const utilizationPrefs = useStore((s) => s.utilizationPrefs);
  // Device-global display pref (default on): narrow the weekend columns. Drives the geometry below.
  const minimiseWeekends = useStore((s) => s.minimiseWeekends);
  // Device-global display pref (default on): after a FREE scroll settles, floor the left edge back
  // to the current week's first day (the scroll-idle snap in onScroll below). FREE SCROLL ONLY —
  // the navigation snap (zoom / Prev-Next / date-picker, Feature 1) is always on, independent of this.
  const snapToWeekStart = useStore((s) => s.snapToWeekStart);
  const toggleGroup = useStore((s) => s.toggleGroup);
  const clearFilters = useStore((s) => s.clearFilters);
  const consumeResourceJump = useStore((s) => s.consumeResourceJump);
  // WCAG 4.1.3: the latest screen-reader capacity announcement, set by AllocationBar after a
  // KEYBOARD-committed move/resize. Rendered ONCE below in a polite aria-live region. It changes
  // only on a keyboard edit (not a scroll/zoom/modal/render), so subscribing here adds no hot-path
  // re-render; pointer drags never set it, so they stay silent for screen readers (sighted feedback).
  const srAnnouncement = useStore((s) => s.srAnnouncement);
  const announceStatus = useStore((s) => s.announceCapacity);
  const draggingAllocationId = useStore((s) => s.draggingAllocationId);
  const [modal, setModal] = useState<ModalState | null>(null);
  const previousDrawMode = useRef(ui.drawMode);
  useEffect(() => {
    if (previousDrawMode.current === ui.drawMode) return;
    previousDrawMode.current = ui.drawMode;
    announceStatus(
      ui.drawMode === "timeoff" ? m.scheduler_sr_timeoff_mode_enabled() : m.scheduler_sr_work_mode_enabled(),
    );
  }, [announceStatus, ui.drawMode]);

  const {
    scrollRef,
    headerRef,
    stickyHeaderHeight,
    timelineWidth,
    timelineHeight,
    scrollTop,
    leftEdgeIdx,
    start,
    end,
    days,
    dayWidth,
    geom,
    onScroll,
    visibleStartDate,
  } = useSchedulerViewport({
    ui,
    minimiseWeekends,
    snapToWeekStart,
    calendarWeekStartsOn,
  });
  const today = useCalendarToday(calendarTimeZone);
  // FIXED forward window from today (overStart..overEnd): drives ONLY the `overSoon` red flag — a
  // near-term, zoom/pan-INDEPENDENT "over soon" radar, so the per-resource overbooked warning fires
  // regardless of the visible range. Kept separate from the displayed % (which follows the view).
  const overStart = today;
  const overEnd = addDaysISO(today, UTILIZATION_WINDOW_DAYS - 1);

  // VISIBLE window [visStart, visEnd]: drives the DISPLAYED utilisation % (per-person, per-discipline
  // avg, overall). The visible span is `ui.zoom * 7` calendar days anchored at the scroll left-edge
  // day; the inclusive end is `+ (zoom*7 - 1)` — a 1-week view is the 7 inclusive days [L, L+6], not
  // +7 (8 days). The end is CLAMPED to the last timeline day so the window never reads past `days[]`.
  // Day-quantized via leftEdgeIdx so a scroll within a column doesn't rebuild the model.
  const { start: visStart, end: visEnd } = useMemo(
    () => visibleWindowFor(days, leftEdgeIdx, ui.zoom, ui.focusDate),
    [days, leftEdgeIdx, ui.zoom, ui.focusDate],
  );

  // Human labels for the visible span: `long` for the utilisation titles ("over the visible N
  // week(s)") and the row summaries, `compact` for the header chip. Memoised because every row's
  // title and screen-reader summary reads them, and they change only when the window does.
  const { long: visibleWeeksLabel, compact: visibleSpanCompact } = useMemo(
    () => visibleSpanLabels(visStart, visEnd),
    [visStart, visEnd],
  );

  // Vertical density ("Compact view" device pref, default OFF = roomier). `density` covers the
  // geometry the VIEW draws directly; `rowLaneLayout` is the projection the MODEL packs lanes with.
  // Both must be memo dependencies of everything derived from them (the model, and the heights
  // prefix-sum below) or a density change would leave stale row heights and bar offsets behind.
  const compactView = useStore((s) => s.compactView);
  const { density, rowLaneLayout } = useMemo(
    () => ({ density: schedulerDensity(compactView), rowLaneLayout: laneLayoutFor(compactView) }),
    [compactView],
  );

  const staticModel = useMemo(
    () =>
      buildSchedulerModel({
        data,
        geom,
        days,
        // The percentage is overlaid below. Keeping this input fixed prevents horizontal scrolling
        // from rebuilding lanes, bars and every timeline day-state.
        visibleWindow: { start: overStart, end: overEnd },
        overSoonWindow: { start: overStart, end: overEnd },
        filters: ui.filters,
        preferences: {
          disciplinesEnabled,
          placeholdersEnabled,
          externalEnabled,
          accountWorkingDays,
          groupResourcesByEngagement,
          blocksMode,
          internalColourMode,
          showInternalProjects,
          showInternalActivities,
        },
        laneLayout: rowLaneLayout,
      }),
    [
      data,
      geom,
      days,
      overStart,
      overEnd,
      ui.filters,
      disciplinesEnabled,
      placeholdersEnabled,
      externalEnabled,
      accountWorkingDays,
      groupResourcesByEngagement,
      blocksMode,
      internalColourMode,
      showInternalProjects,
      showInternalActivities,
      rowLaneLayout,
    ],
  );
  const model = useMemo(
    () => refreshVisibleUtilization(staticModel, data, visStart, visEnd, accountWorkingDays, blocksMode),
    [staticModel, data, visStart, visEnd, accountWorkingDays, blocksMode],
  );

  const todayX = today >= start && today <= end ? geom.xForDateInGeom(today) : null;

  const filtersActive = hasActiveFilters(ui.filters);

  // Stable callbacks so the memoised ResourceLane can skip re-rendering on
  // grid-level UI changes (e.g. opening a modal). setModal is referentially stable.
  const handleEdit = useCallback((allocationId: ID) => setModal({ kind: "edit", allocationId }), []);
  const handleDraw = useCallback((resourceId: ID, startDate: ISODate, endDate: ISODate) => {
    // Read the draw mode LIVE (getState) when the gesture FIRES, not via a closure over
    // ui.drawMode. That's load-bearing: closing over ui.drawMode would give handleDraw a fresh
    // reference on every toggle, which `onDraw` hands to every ResourceLane — failing their
    // React.memo and re-rendering every lane (and its bars) on a mode toggle. The mode that
    // matters is the one live at pointerup, which is exactly what getState() returns here, so
    // an EMPTY dep array keeps this callback referentially stable across a toggle. Time off is
    // meaningless for externals (no capacity), so a draw on their lane is a no-op rather than
    // opening a time-off form seeded with a resource the picker itself excludes.
    const state = useStore.getState();
    const drawMode = state.ui.drawMode;
    const resource = state.data.resources.find((candidate) => candidate.id === resourceId);
    if (!resource) return;
    // The SAME gate the model paints `creationBlocked` with, so a lane can never accept a draw on a
    // day it drew as unavailable. It scopes time off to the resource itself, so no pre-filter here.
    // EXCEPT in time-off draw mode: a closure must not swallow the gesture — sick
    // leave can legitimately start inside a closure, and the Add time off form accepts the
    // identical entry. Personal overlaps and non-working days still gate the draw.
    const gateTimeOff = state.data.timeOff;
    if (
      isCreationStartBlocked(
        resource,
        startDate,
        gateTimeOff,
        accountWorkingDaysFor(state.data, state.activeAccountId),
        drawMode === "timeoff" ? [] : state.data.closures,
      )
    ) {
      return;
    }
    if (drawMode === "timeoff") {
      if (isExternalResource(resource)) return;
    }
    setModal({
      kind: drawMode === "timeoff" ? "timeoff" : "create",
      resourceId,
      startDate,
      endDate,
    });
  }, []);

  // Derived from the model only — memoise so opening a modal / measuring the
  // container (frequent re-renders) doesn't re-flatMap + re-reduce every row.
  const overallUtil = useMemo(
    // Exclude external / 3rd-party rows: they carry no capacity (utilisation 0) and would
    // otherwise drag the headline average down. NOTE the group figure below guards on the whole
    // BAND instead, so a mixed group still averages an external row in at 0% — a known
    // inconsistency between the two figures, deliberately left alone by this refactor.
    () => averageUtilizationPercent(model.flatMap((g) => g.rows).filter((r) => isCapacityTracked(r.resource))),
    [model],
  );

  // Flatten the visible model into one ordered list of renderable items (group
  // headers + the rows of expanded groups) so the grid can window them vertically:
  // at small scale everything renders; past a viewport's worth, only the on-screen
  // slice is in the DOM (the rest is reserved by top/bottom spacers).
  type Item = { kind: "group"; group: GroupModel } | { kind: "row"; group: GroupModel; row: RowModel };
  const items = useMemo(() => {
    const collapsedKeys = new Set(ui.collapsedGroups);
    const out: Item[] = [];
    for (const group of model) {
      // Every model group is now meaningful and labelled: a discipline, Studio/Supplementary,
      // Unassigned, or External. Keep the same collapse behaviour for synthetic fallback bands.
      out.push({ kind: "group", group });
      if (!collapsedKeys.has(group.key)) for (const row of group.rows) out.push({ kind: "row", group, row });
    }
    return out;
  }, [model, ui.collapsedGroups]);

  // Heights + their prefix-sum depend only on the item set (model/collapse), NOT on
  // scroll — memoise so a scroll frame only runs the cheap edge-scan in windowFromLayout.
  const heights = useMemo(
    () => items.map((it) => (it.kind === "group" ? density.groupHeaderHeight : it.row.rowHeight)),
    [items, density],
  );
  const layout = useMemo(() => buildLayout(heights), [heights]);
  const externalGroupIndex = items.findIndex((item) => item.kind === "group" && item.group.external);
  const trackedGridHeight = externalGroupIndex === -1 ? layout.total : (layout.tops[externalGroupIndex] ?? 0);
  const timelineStart = days[0];
  const timelineEnd = days[days.length - 1];
  const visibleClosures = useMemo(
    () =>
      timelineStart && timelineEnd
        ? data.closures.filter(
            (closure) =>
              closure.startDate <= closure.endDate &&
              closure.endDate >= timelineStart &&
              closure.startDate <= timelineEnd,
          )
        : [],
    [data.closures, timelineEnd, timelineStart],
  );

  // Scroll a specific resource row into view when jumpToResource fires (command
  // palette "jump to person"). Mirrors the recenterToken pattern. Uses layout.tops
  // (prefix-sum of row heights) to find the vertical offset.
  const scrollToResource = ui.scrollToResource;
  useEffect(() => {
    if (!scrollToResource || scrollToResource.consumed || !scrollRef.current) return;
    const idx = items.findIndex((it) => it.kind === "row" && it.row.resource.id === scrollToResource.id);
    if (idx === -1) return;
    const top = layout.tops[idx] ?? 0;
    scrollRef.current.scrollTop = top;
    consumeResourceJump(scrollToResource.token);
  }, [scrollToResource, items, layout, scrollRef, consumeResourceJump]);

  const { first, last } = windowFromLayout(layout, heights, scrollTop, timelineHeight);
  // Memoised because this scan is O(rows × bars) and the grid re-renders every frame while a drag
  // autoscrolls — the dragged row only changes when the item set or the dragged id changes, never
  // per scroll pixel. Same keying discipline as the neighbouring derived values above.
  const draggedItemIndex = useMemo(
    () =>
      draggingAllocationId === null
        ? -1
        : items.findIndex(
            (item) => item.kind === "row" && item.row.bars.some((bar) => bar.allocation.id === draggingAllocationId),
          ),
    [items, draggingAllocationId],
  );
  const renderedIndices = useMemo(() => {
    const indices = Array.from({ length: Math.max(0, last - first + 1) }, (_, offset) => first + offset);
    if (draggedItemIndex >= 0 && (draggedItemIndex < first || draggedItemIndex > last)) {
      indices.push(draggedItemIndex);
      indices.sort((a, b) => a - b);
    }
    return indices;
  }, [first, last, draggedItemIndex]);

  const renderGroupHeader = (group: GroupModel, rowIndex: number, key: string) => {
    const collapsed = ui.collapsedGroups.includes(group.key);
    return (
      <div
        key={key}
        role="row"
        aria-rowindex={rowIndex}
        data-testid="discipline-group"
        className="flex border-y border-line-soft bg-scheduler-group text-faint"
        style={{ height: density.groupHeaderHeight }}
      >
        <div
          role="rowheader"
          aria-colindex={1}
          className="sticky left-0 z-10 shrink-0"
          style={{ width: LAYOUT.leftColWidth }}
        >
          <Button
            variant="ghost"
            onClick={() => toggleGroup(group.key)}
            aria-expanded={!collapsed}
            className="h-full w-full justify-start rounded-none px-3 text-xs font-semibold uppercase tracking-wide"
          >
            {collapsed ? <ChevronRight data-icon="inline-start" /> : <ChevronDown data-icon="inline-start" />}
            <span
              className="inline-block size-2.5 rounded-full ring-1 ring-inset ring-black/10"
              style={{ backgroundColor: group.color ?? "var(--color-faint)" }}
            />
            <span className="truncate text-ink">{group.title}</span>
          </Button>
        </div>
        <div
          role="gridcell"
          aria-colindex={2}
          className="flex shrink-0 items-center px-3 text-xs"
          style={{ width: geom.totalWidth }}
        >
          {collapsed
            ? m.scheduler_group_hidden({ count: group.rows.length })
            : group.external
              ? "" /* external parties have no capacity — an avg utilisation here would misleadingly read 0% */
              : utilizationPrefs.showDiscipline
                ? m.scheduler_group_avg_utilisation({ percent: averageUtilizationPercent(group.rows) })
                : ""}
        </div>
      </div>
    );
  };

  const renderRow = (group: GroupModel, row: RowModel, rowIndex: number, key: string) => {
    const { resource, rowHeight, bars, dayStates, timeOff, utilization: util, overSoon, dimmed } = row;
    return (
      /* One scheduler-row surface on the whole row (not just the sticky header) keeps the divider
         on ONE background — without it the border crosses the frozen left column
         and the darker timeline, reading as a two-tone line. */
      <div
        key={key}
        role="row"
        aria-rowindex={rowIndex}
        data-testid="scheduler-row"
        data-dimmed={dimmed || undefined}
        title={dimmed ? m.scheduler_row_dimmed_title() : undefined}
        className={`flex border-b border-line-soft bg-scheduler-canvas ${dimmed ? "opacity-45" : ""}`}
        style={{ height: rowHeight }}
      >
        <div
          role="rowheader"
          aria-colindex={1}
          className={`sticky left-0 z-10 flex shrink-0 items-start gap-2 border-r border-line bg-scheduler-canvas ps-3 ${
            resource.kind === "placeholder" ? "hatch-lines" : ""
          }`}
          style={{ width: LAYOUT.leftColWidth }}
        >
          {/* Text equivalent of the colour-only capacity cues (over-marker red background, time-off
              tint and half-day tint) — assembled in rowSummary.ts so the wording is unit-testable. */}
          <span className="sr-only">
            {rowScreenReaderSummary(row, {
              showPersonalUtilization: utilizationPrefs.showPersonal,
              visibleSpanLabel: visibleWeeksLabel,
              drawMode: ui.drawMode,
            })}
          </span>
          {/* Avatar + identity, vertically centred within the FIRST lane band
              (rowPadding + barHeight + rowPadding = a single-lane row height) and pinned to
              the top of the row. So a one-lane row keeps its balanced top/bottom padding
              (the band IS the whole row), while a taller multi-allocation row keeps the name
              aligned with the first bar instead of drifting to the row's centre as it grows.
              The "+/%" box stays self-stretch (full height); only this block is banded. */}
          <div className="flex min-w-0 flex-1 items-center gap-2" style={{ height: density.identityBandHeight }}>
            {/* Avatar fill follows the DISCIPLINE colour (group.color), so everyone in a
                discipline reads as one colour; synthetic engagement/unassigned groups fall
                back to each resource's own colour. */}
            <Avatar
              name={resource.name ?? resource.role}
              color={group.color ?? resource.color}
              placeholder={resource.kind === "placeholder"}
            />
            {/* ms-1.5: a little extra breathing room between the avatar and the text. */}
            <div className="ms-1.5 min-w-0 flex-1">
              <span className="flex items-center gap-1 truncate text-sm font-medium">
                {/* A placeholder ("slot") reads as the literal word "Placeholder" — an as-yet-unfilled
                    slot — with its role/discipline shown as secondary text below. */}
                {resourceDisplayName(resource)}
              </span>
              <span className="block truncate text-xs text-muted-foreground">{resource.role}</span>
            </div>
          </div>
          {/* Right column: the add button and (optionally) the allocation %, stacked.
              The box always fills the full row height (self-stretch), and each cell takes
              an equal share (flex-1) — so the + alone fills the box, or the +/% split it
              50/50, and both grow with the row when allocations stack. Only the start
              border is drawn: the row's border-b and the panel's border-r close the box
              off, so there's no doubled hairline against those dividers. */}
          <div className="flex shrink-0 flex-col self-stretch overflow-hidden border-s border-line text-center leading-none">
            {/* Viewer (P1.12): no per-row create affordance. Hidden, not disabled — a viewer schedule
                is display-only. The utilisation % below still renders (a read, not an edit). */}
            {canEdit && (ui.drawMode !== "timeoff" || !isExternalResource(resource)) && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  const d = visibleStartDate();
                  setModal({
                    kind: ui.drawMode === "timeoff" ? "timeoff" : "create",
                    resourceId: resource.id,
                    startDate: d,
                    endDate: d,
                  });
                }}
                aria-label={
                  ui.drawMode === "timeoff"
                    ? m.scheduler_add_timeoff_for({ name: resourceDisplayName(resource) })
                    : m.scheduler_add_allocation_for({ name: resourceDisplayName(resource) })
                }
                title={ui.drawMode === "timeoff" ? m.scheduler_add_timeoff() : m.scheduler_add_allocation()}
                className="h-auto w-11 flex-1 rounded-none text-muted-foreground"
              >
                <Plus />
              </Button>
            )}
            {utilizationPrefs.showPersonal && isCapacityTracked(resource) && (
              <span
                data-testid="utilization"
                title={
                  // The % itself is over the VISIBLE range; the overSoon red flag is the separate
                  // fixed-window "over soon" warning (next UTILIZATION_WINDOW_DAYS days).
                  overSoon
                    ? m.scheduler_util_title_oversoon({
                        days: UTILIZATION_WINDOW_DAYS,
                        span: visibleWeeksLabel,
                      })
                    : m.scheduler_util_title({ span: visibleWeeksLabel })
                }
                className={`flex w-11 flex-1 items-center justify-center border-t border-line text-2xs ${
                  overSoon ? "font-semibold text-danger" : "text-faint"
                }`}
              >
                {formatUtilizationPercent(util)}%
              </span>
            )}
          </div>
        </div>

        <ResourceLane
          resourceId={resource.id}
          // Accessible name for the lane's role="gridcell" (col 2): the timeline cell was
          // previously unnamed. "<name> timeline" names it without duplicating the rowheader's
          // sr-only capacity summary, so the cell reads honestly in the column structure (WCAG 1.3.1).
          ariaLabel={m.scheduler_lane_aria({
            name: resourceDisplayName(resource),
          })}
          days={days}
          dayStates={dayStates}
          timeOff={timeOff}
          todayX={todayX}
          dayWidth={dayWidth}
          geom={geom}
          rowHeight={rowHeight}
          barTop={density.rowPadding}
          bars={bars}
          placeholder={resource.kind === "placeholder"}
          weekStartsOn={calendarWeekStartsOn}
          // Viewer (P1.12): pass NO edit/draw callbacks — the lane then bails its draw gesture and
          // drops the hover "+" hint (display-only). Editable (null/owner/admin/editor, incl.
          // OFF/local) gets the stable memoised callbacks, byte-identical to today.
          onEdit={canEdit ? handleEdit : undefined}
          onDraw={canEdit ? handleDraw : undefined}
        />
      </div>
    );
  };

  return (
    // A SINGLE shared TooltipProvider for the whole grid: every AllocationBar's popover is a
    // provider-less TooltipRoot, so the provider machinery is paid once here instead of per bar
    // across the virtualised grid (the same hoist pattern as ui/sidebar.tsx).
    <TooltipProvider>
      {/* h-full passthrough wrapper: holds the scrolling role="grid" plus its sibling live region.
        The grid must own ONLY row/rowgroup children (WCAG aria-required-children), so the polite
        status region lives HERE, a sibling of the grid — not inside it. It's sr-only (position:
        absolute, zero layout), so this wrapper adds no visual change and the grid's h-full still
        resolves against the same definite height it did before. */}
      <div className="h-full">
        <div
          ref={scrollRef}
          /* overscroll-x-contain: hitting the timeline's left edge must NOT chain into the
           page — on macOS that overscroll is the browser's back-swipe, which nukes the app. */
          className="relative flex h-full flex-col overflow-auto overscroll-x-contain bg-scheduler-canvas"
          data-testid="scheduler-grid"
          /* Signals the active draw mode to CSS: in "timeoff" mode the stylesheet fades the
           work bars back and makes booked time-off glow, so the toolbar toggle gives an
           immediate, whole-grid response (it otherwise read as a dead button). This VISUAL
           re-skin is a single attribute toggle — purely a CSS reflow, no React re-render of any
           lane or bar. A toggle DOES re-render THIS grid (it subscribes to `s.ui`), but every prop
           it passes each ResourceLane is held stable across a toggle (the model/geom props don't
           depend on drawMode, and `onDraw`/`onEdit` are memoised below to NOT close over it), so the
           memoised lanes — and their bars — bail. (The parallel `inert` BEHAVIOUR — bars
           non-interactive + off the tab/a11y tree — is set on each lane's bars layer, not here; see
           ResourceLane's BarsLayer. That layer DOES re-render on toggle — it's the one component that
           subscribes to the mode — but it's a single thin DOM write that hands its bars unchanged
           refs, so the memoised bars bail too.) */
          data-draw-mode={ui.drawMode}
          role="grid"
          aria-label={m.scheduler_grid_aria()}
          // Two-column grid (WCAG 1.3.1): col 1 = the sticky left resource/utilisation column
          // (every row's rowheader / the header's columnheader), col 2 = the timeline lane
          // (the gridcell / the DateHeader columnheader). aria-colcount declares that structure so
          // the grid honestly exposes the columns it implies; every left cell carries aria-colindex=1
          // and every right cell aria-colindex=2 below. (Keyboard nav is on the bars — role="button",
          // not the cells — so these indices are pure structure, not a focus model.)
          aria-colcount={2}
          aria-rowcount={items.length + 1 + (model.length === 0 ? 1 : 0)}
          onScroll={onScroll}
          // Publish the measured sticky-header height so each AllocationBar's scroll-margin-top reserves
          // the REAL chrome on focus (WCAG 2.4.11), tracking the two-tier header's actual rendered height
          // (zoom/font-size dependent) instead of the LAYOUT.headerHeight floor. Cast: a CSS custom
          // property isn't in React's CSSProperties type.
          style={{
            ["--sched-sticky-top" as string]: `${stickyHeaderHeight}px`,
            // DateHeader aligns wide-view month labels to the VISIBLE part of their month.
            // The scroll offset is updated imperatively by useSchedulerViewport so horizontal
            // scrolling moves only a CSS variable instead of re-rendering the scheduler per pixel.
            ["--sched-visible-width" as string]: `${Math.max(0, timelineWidth - LAYOUT.leftColWidth)}px`,
          }}
        >
          {/* min-w-max: this is a flex item of the flex-col scroll container, so the
            default align-items:stretch would clamp its width to the container's cross
            size (the viewport), leaving the wide DateHeader to overflow and only the
            first ~2 weeks painted. Sizing to content makes header + rows span the full
            timeline and scroll together. Same reason on the rowgroup below. */}
          <div
            ref={headerRef}
            role="row"
            aria-rowindex={1}
            className="sticky top-0 z-20 flex min-w-max shrink-0 border-b border-line-soft bg-scheduler-header"
            style={{ minHeight: LAYOUT.headerHeight }}
          >
            <div
              data-testid="scheduler-resource-header"
              role="columnheader"
              aria-colindex={1}
              aria-label={m.scheduler_resources_column()}
              className="sticky left-0 z-30 flex shrink-0 flex-col justify-center border-r border-line bg-scheduler-header px-3"
              style={{ width: LAYOUT.leftColWidth }}
            >
              {utilizationPrefs.showTotal && (
                <>
                  <span
                    className="text-2xs font-medium uppercase tracking-wide text-faint"
                    title={m.scheduler_total_util_title({
                      span: visibleWeeksLabel,
                    })}
                  >
                    {/* The headline % follows the VISIBLE range, so the label tracks the selected zoom
                      span (1/2/4/6/8 weeks) rather than naming a fixed "next 2w". */}
                    {m.scheduler_total_util_label({ span: visibleSpanCompact })}
                  </span>
                  <span data-testid="overall-utilization" className="text-sm font-semibold">
                    {overallUtil}%
                  </span>
                </>
              )}
            </div>
            <DateHeader
              days={days}
              dayWidth={dayWidth}
              geom={geom}
              visibleWeeks={ui.zoom}
              weekStartsOn={calendarWeekStartsOn}
              today={today}
            />
          </div>

          {model.length === 0 && (
            // Empty body, below the still-rendered toolbar + date header, centring the shared EmptyState
            // (the same icon/heading/subtext/CTA pattern the entity lists use). The grid scrolls
            // horizontally (its header is min-w-max), so this must be sticky left-0 + bounded to the
            // measured viewport width (timelineWidth) or the centred card drifts off-screen with the
            // scroll — and it must be a DIRECT child of the overflow-auto grid for sticky to pin (nested
            // inside the wide row it did not). role=grid > row > gridcell keeps the a11y tree valid.
            <div
              role="row"
              aria-rowindex={2}
              data-testid="scheduler-empty"
              className="sticky left-0 z-[1] flex min-h-0 flex-1 items-center justify-center p-8"
              style={{ width: timelineWidth || LAYOUT.leftColWidth }}
            >
              <div role="gridcell" aria-colindex={1} aria-colspan={2} className="flex items-center justify-center">
                {filtersActive ? (
                  // Heading text is pinned EXACTLY by filters.spec.ts + US-FIL-07. The Clear-filters CTA
                  // is also the keyboard-focusable element that keeps the (scrollable) grid axe-clean when
                  // empty — without a focusable child, axe flags scrollable-region-focusable.
                  <EmptyState
                    icon={SlidersHorizontal}
                    description={m.scheduler_empty_filtered_desc()}
                    action={{
                      label: m.scheduler_empty_clear_filters(),
                      onClick: () => clearFilters(),
                    }}
                  >
                    {m.scheduler_empty_filtered_title()}
                  </EmptyState>
                ) : (
                  <EmptyState
                    icon={Users}
                    description={m.scheduler_empty_desc()}
                    action={{
                      label: m.scheduler_empty_go_resources(),
                      onClick: () => void navigate("/resources"),
                    }}
                  >
                    {m.scheduler_empty_title()}
                  </EmptyState>
                )}
              </div>
            </div>
          )}

          {items.length > 0 && (
            <div role="rowgroup" className="relative min-w-max shrink-0">
              {renderedIndices.map((itemIndex, position) => {
                const item = items[itemIndex];
                if (!item) return null;
                const previousIndex = renderedIndices[position - 1];
                const previousBottom =
                  previousIndex === undefined ? 0 : (layout.tops[previousIndex] ?? 0) + (heights[previousIndex] ?? 0);
                const gap = Math.max(0, (layout.tops[itemIndex] ?? 0) - previousBottom);
                // aria-rowindex is 1-based and global: header is 1, so items start at 2.
                const rowIndex = itemIndex + 2;
                const rendered =
                  item.kind === "group"
                    ? renderGroupHeader(item.group, rowIndex, `g-${item.group.key}`)
                    : renderRow(item.group, item.row, rowIndex, `r-${item.row.resource.id}`);
                return (
                  <Fragment key={`window-${itemIndex}`}>
                    {gap > 0 && <div aria-hidden style={{ height: gap }} />}
                    {rendered}
                  </Fragment>
                );
              })}
              {renderedIndices.length > 0 &&
                (() => {
                  const finalIndex = renderedIndices[renderedIndices.length - 1];
                  const renderedBottom = (layout.tops[finalIndex] ?? 0) + (heights[finalIndex] ?? 0);
                  const gap = Math.max(0, layout.total - renderedBottom);
                  return gap > 0 ? <div aria-hidden style={{ height: gap }} /> : null;
                })()}
              {timelineStart &&
                timelineEnd &&
                visibleClosures.map((closure) => (
                  <ClosureBand
                    key={closure.id}
                    closure={closure}
                    visibleStart={timelineStart}
                    visibleEnd={timelineEnd}
                    geom={geom}
                    leftOffset={LAYOUT.leftColWidth}
                    height={trackedGridHeight}
                  />
                ))}
            </div>
          )}

          {modal && (
            <Suspense fallback={null}>
              {modal.kind === "edit" ? (
                <AllocationModal allocationId={modal.allocationId} onClose={() => setModal(null)} />
              ) : modal.kind === "timeoff" ? (
                <TimeOffForm
                  defaults={{
                    resourceId: modal.resourceId,
                    startDate: modal.startDate,
                    endDate: modal.endDate,
                  }}
                  onClose={() => setModal(null)}
                />
              ) : (
                <AllocationModal
                  create={{
                    resourceId: modal.resourceId,
                    startDate: modal.startDate,
                    endDate: modal.endDate,
                  }}
                  onClose={() => setModal(null)}
                />
              )}
            </Suspense>
          )}
        </div>

        {visibleClosures.length > 0 && (
          <div className="sr-only">
            {visibleClosures.map((closure) => (
              <span key={closure.id}>
                {m.scheduler_closure_aria({
                  name: closure.name,
                  start: closure.startDate,
                  end: closure.endDate,
                })}
              </span>
            ))}
          </div>
        )}

        {/* WCAG 4.1.3 (Status Messages): the SINGLE scheduler live region. A keyboard move/resize on a
          bar recomputes over-capacity and silently mutates the per-row sr-only summary while focus
          stays on the bar — this polite region speaks the recomputed outcome for the affected
          resource so a screen-reader user gets feedback on their own edit. `polite` (not assertive)
          so it never interrupts; `aria-atomic` so the whole message is read, not a diff. Fired ONLY
          from AllocationBar's keyboard path (pointer drags stay silent — sighted feedback). The
          inner span is KEYED on `seq` so React replaces the node and the SAME text re-announces (an
          aria-live region re-reads only on a content change). Visually hidden (sr-only).
          It is a SIBLING of role="grid" (a grid may own only row/rowgroup children — WCAG
          aria-required-children — and role="status" is neither), kept mounted unconditionally
          alongside the grid so an announcement always lands. */}
        <div
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="scheduler-live-region"
        >
          {srAnnouncement && <span key={srAnnouncement.seq}>{srAnnouncement.text}</span>}
        </div>
      </div>
    </TooltipProvider>
  );
}
