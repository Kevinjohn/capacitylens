import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { hasActiveFilters, useStore } from "@/store/useStore";
import { useActiveScopedData } from "@/store/useScopedData";
import { carriesHourlyLoad, emptyAppData } from "@capacitylens/shared/types/entities";
import { LAYOUT, SCHEDULER_DENSITY, SCHEDULER_LANE_LAYOUT } from "./layout";
import { buildSchedulerModel, applyVisibleUtilization } from "./schedulerModel";
import { useCalendarToday } from "./useCalendarToday";
import { buildVisibleSpanLabels, resolveVisibleWindow } from "./visibleSpan";
import { buildAverageUtilizationLabel } from "./schedulerGridModal";
import type { useSchedulerViewport } from "./useSchedulerViewport";
import {
  hasDisciplinesEnabled,
  hasExternalResourcesEnabled,
  hasPlaceholdersEnabled,
  resolveSchedulingMode,
  resolveTimeZone,
  resolveWeekStart,
} from "@/store/accountSettingsSelectors";
import { defaultAccountWorkingDays, normalizeAccountWorkingDays } from "@capacitylens/shared/lib/accountWorkingDays";
import { addDaysISO } from "@capacitylens/shared/lib/dateMath";
import { UTILIZATION_WINDOW_DAYS } from "@/lib/schedulerConfig";

type GridPreferences = ReturnType<typeof useSchedulerGridPreferences>;
type GridViewport = Pick<
  ReturnType<typeof useSchedulerViewport>,
  "days" | "leftEdgeIdx" | "start" | "end" | "geom" | "scrollRef" | "timelineWidth"
>;

interface SchedulerModelProjectionInput {
  preferences: GridPreferences;
  viewport: GridViewport;
  overStart: string;
  overEnd: string;
  visibleStart: string;
  visibleEnd: string;
  rowLaneLayout: typeof SCHEDULER_LANE_LAYOUT;
  partiallyExposesNextColumn: boolean;
}

/** Checks whether the viewport reveals a partial next date column. */
export function partiallyExposesNextColumn({
  geometry,
  days,
  scrollLeft,
  timelineWidth,
  zoom,
}: {
  geometry: GridViewport["geom"];
  days: GridViewport["days"];
  scrollLeft: number;
  timelineWidth: number;
  zoom: number;
}) {
  const viewportWidth = timelineWidth - LAYOUT.leftColWidth;
  const leftEdgeIndex = geometry.indexAtScroll(scrollLeft);
  const endIndex = Math.min(leftEdgeIndex + zoom * 7 - 1, days.length - 1);
  return viewportWidth > 0 && endIndex < days.length - 1 && scrollLeft + viewportWidth > geometry.x(endIndex + 1);
}

/** Tracks partial-column visibility as the grid viewport moves. */
export function usePartiallyExposedNextColumn(viewport: GridViewport, zoom: number) {
  const { scrollRef, geom: geometry, days, timelineWidth } = viewport;
  // Freeze partial-column visibility with the horizontal gesture window so scrolling during drag cannot repack lanes under the pointer.
  const dragging = useStore((state) => state.draggingAllocationId !== null);
  const exposedRef = useRef(false);
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const element = scrollRef.current;
      if (!element) return () => undefined;
      element.addEventListener("scroll", onStoreChange);
      return () => element.removeEventListener("scroll", onStoreChange);
    },
    [scrollRef],
  );
  const getSnapshot = useCallback(() => {
    if (dragging) return exposedRef.current;
    exposedRef.current = partiallyExposesNextColumn({
      geometry,
      days,
      scrollLeft: scrollRef.current?.scrollLeft ?? 0,
      timelineWidth,
      zoom,
    });
    return exposedRef.current;
  }, [dragging, days, geometry, scrollRef, timelineWidth, zoom]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

function buildModelPreferences(
  accountPrefs: GridPreferences["accountPrefs"],
  accountWorkingDays: GridPreferences["accountWorkingDays"],
) {
  return {
    disciplinesEnabled: accountPrefs.disciplinesEnabled,
    placeholdersEnabled: accountPrefs.placeholdersEnabled,
    externalEnabled: accountPrefs.externalEnabled,
    accountWorkingDays,
    blocksMode: accountPrefs.blocksMode,
  };
}

function useSchedulerModelProjection({
  preferences: { data, accountPrefs, accountWorkingDays, ui },
  viewport: { days, geom },
  overStart,
  overEnd,
  visibleStart,
  visibleEnd,
  rowLaneLayout,
  partiallyExposesNextColumn,
}: SchedulerModelProjectionInput) {
  const modelPreferences = useMemo(
    () => buildModelPreferences(accountPrefs, accountWorkingDays),
    [accountPrefs, accountWorkingDays],
  );
  const staticModel = useMemo(
    () =>
      buildSchedulerModel({
        data,
        geom,
        days,
        visibleWindow: { start: overStart, end: overEnd },
        overSoonWindow: { start: overStart, end: overEnd },
        filters: ui.filters,
        preferences: modelPreferences,
        laneLayout: rowLaneLayout,
      }),
    [data, geom, days, overStart, overEnd, ui.filters, modelPreferences, rowLaneLayout],
  );
  return useMemo(
    () =>
      applyVisibleUtilization({
        model: staticModel,
        data,
        start: visibleStart,
        end: visibleEnd,
        accountWorkingDays,
        blocksMode: accountPrefs.blocksMode,
        laneLayout: rowLaneLayout,
        partiallyExposesNextColumn,
      }),
    [
      staticModel,
      data,
      visibleStart,
      visibleEnd,
      accountWorkingDays,
      accountPrefs.blocksMode,
      rowLaneLayout,
      partiallyExposesNextColumn,
    ],
  );
}

/** Resolve preferences before the single viewport owner computes its geometry. */
export function useSchedulerGridPreferences() {
  const data = useActiveScopedData();
  const activeAccount = useStore((state) =>
    state.data.accounts.find((account) => account.id === state.activeAccountId),
  );
  // Resolve account preferences from one account row to avoid repeated lookups, while retaining each shared selector's absent-field default.
  const accountPreferences = useMemo(() => {
    const view = { ...emptyAppData(), accounts: activeAccount ? [activeAccount] : [] };
    const id = activeAccount?.id ?? null;
    return {
      placeholdersEnabled: hasPlaceholdersEnabled(view, id),

      externalEnabled: hasExternalResourcesEnabled(view, id),

      disciplinesEnabled: hasDisciplinesEnabled(view, id),
      blocksMode: !carriesHourlyLoad(resolveSchedulingMode(view, id)),
      calendarTimeZone: resolveTimeZone(view, id),
      calendarWeekStartsOn: resolveWeekStart(view, id),
    };
  }, [activeAccount]);
  const accountWorkingDays = useMemo(() => {
    const weekStartsOn = activeAccount?.weekStartsOn ?? 1;
    return activeAccount?.workingDays === undefined
      ? defaultAccountWorkingDays(weekStartsOn)
      : normalizeAccountWorkingDays(activeAccount.workingDays, weekStartsOn);
  }, [activeAccount]);
  const ui = useStore((state) => state.ui);

  const utilizationPreferences = useStore((state) => state.utilizationPrefs);

  const minimiseWeekends = useStore((state) => state.minimiseWeekends);
  // Free-scroll snapping is normally enabled and has only a test override. Programmatic navigation anchors independently.
  const weekSnapEnabled = useStore((state) => state.weekSnapEnabled);
  return {
    data,
    accountPrefs: accountPreferences,
    accountWorkingDays,
    ui,
    utilizationPrefs: utilizationPreferences,
    minimiseWeekends,
    weekSnapEnabled,
  };
}

/** Combines visible geometry, scoped data, and preferences for the week grid. */
export function useSchedulerGridModel(preferences: GridPreferences, viewport: GridViewport) {
  const { accountPrefs: accountPreferences, ui } = preferences;
  const { days, leftEdgeIdx: leftEdgeIndex, start, end, geom: geometry } = viewport;
  const partiallyExposesNextColumnState = usePartiallyExposedNextColumn(viewport, ui.zoom);
  const { calendarTimeZone } = accountPreferences;
  const today = useCalendarToday(calendarTimeZone);
  // overSoon uses a fixed forward window from today, independently of zoom and pan.
  const overStart = today;
  const overEnd = addDaysISO(today, UTILIZATION_WINDOW_DAYS - 1);

  // Visible utilisation uses an inclusive zoom window, clamped to materialized dates and updated only when its left-edge date changes.
  const { start: visibleStart, end: visibleEnd } = useMemo(
    () => resolveVisibleWindow({ days, leftEdgeIndex, zoom: ui.zoom, focusDate: ui.focusDate }),
    [days, leftEdgeIndex, ui.zoom, ui.focusDate],
  );

  // Cache span labels with the window so every row reuses the same description without rebuilding it on unrelated renders.
  const { long: visibleWeeksLabel, compact: visibleSpanCompact } = useMemo(
    () => buildVisibleSpanLabels(visibleStart, visibleEnd),
    [visibleStart, visibleEnd],
  );

  const density = SCHEDULER_DENSITY;
  const rowLaneLayout = SCHEDULER_LANE_LAYOUT;

  const model = useSchedulerModelProjection({
    preferences,
    viewport,
    overStart,
    overEnd,
    visibleStart,
    visibleEnd,
    rowLaneLayout,
    partiallyExposesNextColumn: partiallyExposesNextColumnState,
  });

  const todayX = today >= start && today <= end ? geometry.xForDateInGeom(today) : null;

  const filtersActive = hasActiveFilters(ui.filters);

  const overallUtil = useMemo(
    // External / 3rd-party rows are excluded inside the shared average; with none tracked, read 0%.
    () => buildAverageUtilizationLabel(model.flatMap((group) => group.rows)) ?? "0",
    [model],
  );

  return { model, density, today, todayX, visibleWeeksLabel, visibleSpanCompact, overallUtil, filtersActive };
}
