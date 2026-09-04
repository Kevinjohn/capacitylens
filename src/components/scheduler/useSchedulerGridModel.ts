import { useMemo } from "react";
import { hasActiveFilters, useStore } from "../../store/useStore";
import { useActiveScopedData } from "../../store/useScopedData";
import { carriesHourlyLoad, emptyAppData, isCapacityTracked } from "@capacitylens/shared/types/entities";
import { laneLayoutFor, schedulerDensity } from "./layout";
import { buildSchedulerModel, refreshVisibleUtilization } from "./schedulerModel";
import { useCalendarToday } from "./useCalendarToday";
import { visibleSpanLabels, visibleWindowFor } from "./visibleSpan";
import { averageUtilizationPercent } from "./schedulerGridModal";
import type { useSchedulerViewport } from "./useSchedulerViewport";
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
} from "../../store/selectors";
import { defaultAccountWorkingDays, normalizeAccountWorkingDays } from "@capacitylens/shared/lib/accountWorkingDays";
import { addDaysISO } from "@capacitylens/shared/lib/dateMath";
import { UTILIZATION_WINDOW_DAYS } from "../../lib/schedulerConfig";

/** Resolve preferences before the single viewport owner computes its geometry. */
export function useSchedulerGridPreferences() {
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
  const accountWorkingDays = useMemo(() => {
    const weekStartsOn = activeAccount?.weekStartsOn ?? 1;
    return activeAccount?.workingDays === undefined
      ? defaultAccountWorkingDays(weekStartsOn)
      : normalizeAccountWorkingDays(activeAccount.workingDays, weekStartsOn);
  }, [activeAccount]);
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
  return { data, accountPrefs, accountWorkingDays, ui, utilizationPrefs, minimiseWeekends, snapToWeekStart };
}

export function useSchedulerGridModel(
  { data, accountPrefs, accountWorkingDays, ui }: ReturnType<typeof useSchedulerGridPreferences>,
  {
    days,
    leftEdgeIdx,
    start,
    end,
    geom,
  }: Pick<ReturnType<typeof useSchedulerViewport>, "days" | "leftEdgeIdx" | "start" | "end" | "geom">,
) {
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
  } = accountPrefs;
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

  return { model, density, today, todayX, visibleWeeksLabel, visibleSpanCompact, overallUtil, filtersActive };
}
