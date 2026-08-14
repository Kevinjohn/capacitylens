import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { eachDayISO, startOfWeekISO } from "@capacitylens/shared/lib/dateMath";
import type { ISODate } from "@capacitylens/shared/types/entities";
import {
  FALLBACK_TIMELINE_WIDTH,
  WEEK_SNAP_IDLE_MS,
  WEEKEND_COLUMN_REM,
  resolveColumnFit,
} from "../../lib/schedulerConfig";
import { visibleRange } from "../../store/selectors";
import { useStore, type SchedulerUI } from "../../store/useStore";
import { buildColumnGeometry, leftEdgeDate } from "./columnGeometry";
import { LAYOUT } from "./layout";
import { weekStartSnapTarget } from "./weekSnap";

interface SchedulerViewportOptions {
  ui: SchedulerUI;
  minimiseWeekends: boolean;
  snapToWeekStart: boolean;
  calendarWeekStartsOn: 0 | 1;
}

const publishScrollLeft = (element: HTMLElement) => {
  element.style.setProperty("--sched-scroll-left", `${element.scrollLeft}px`);
};

const setScrollLeft = (element: HTMLElement, value: number) => {
  element.scrollLeft = value;
  publishScrollLeft(element);
};

/**
 * Owns the scheduler's DOM viewport protocol: measurement, column geometry,
 * horizontal date anchoring, vertical scroll state and idle week snapping.
 * SchedulerGrid consumes the resulting view state without knowing how it is kept
 * aligned with the mutable scroll container.
 */
export function useSchedulerViewport({
  ui,
  minimiseWeekends,
  snapToWeekStart,
  calendarWeekStartsOn,
}: SchedulerViewportOptions) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const didScroll = useRef(false);
  const scrollRaf = useRef(0);
  const snapTimer = useRef(0);
  const [stickyHeaderHeight, setStickyHeaderHeight] = useState(LAYOUT.headerHeight);
  const [timelineWidth, setTimelineWidth] = useState(0);
  const [timelineHeight, setTimelineHeight] = useState(0);
  const [rootFontSizePx, setRootFontSizePx] = useState(16);
  const [scrollTop, setScrollTop] = useState(0);
  const [leftEdgeIdx, setLeftEdgeIdx] = useState(-1);

  // Measure before paint so remounting the schedule never flashes fallback geometry.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let measuredWidth = -1;
    let measuredHeight = -1;
    let measuredRootFontSize = -1;
    const readMeasurements = () => ({
      width: el.clientWidth,
      height: el.clientHeight,
      rootFontSize: parseFloat(getComputedStyle(document.documentElement).fontSize) || 16,
    });
    const measure = () => {
      const { width, height, rootFontSize } = readMeasurements();
      if (width !== measuredWidth) {
        measuredWidth = width;
        setTimelineWidth(width);
      }
      if (height !== measuredHeight) {
        measuredHeight = height;
        setTimelineHeight(height);
      }
      if (rootFontSize !== measuredRootFontSize) {
        measuredRootFontSize = rootFontSize;
        setRootFontSizePx(rootFontSize);
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    let resizeTimer = 0;
    const onResize = () => {
      // ResizeObserver always reports once after observe(), even though the synchronous measure
      // above already captured that geometry. Firefox can deliver a deferred callback for that
      // redundant notification while React is replaying layout effects in development Strict
      // Mode, so do not schedule (or dispatch state for) unchanged dimensions.
      const { width, height, rootFontSize } = readMeasurements();
      if (width === measuredWidth && height === measuredHeight && rootFontSize === measuredRootFontSize) return;
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(measure, 0);
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(el);
    return () => {
      clearTimeout(resizeTimer);
      observer.disconnect();
    };
  }, []);

  // AllocationBar uses the measured sticky height as its focus-obscuring margin.
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    let measuredHeight = -1;
    const measure = () => {
      const height = el.offsetHeight || LAYOUT.headerHeight;
      if (height === measuredHeight) return;
      measuredHeight = height;
      setStickyHeaderHeight(height);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    let resizeTimer = 0;
    const onResize = () => {
      const height = el.offsetHeight || LAYOUT.headerHeight;
      if (height === measuredHeight) return;
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(measure, 0);
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(el);
    return () => {
      clearTimeout(resizeTimer);
      observer.disconnect();
    };
  }, []);

  const availableWidth = (timelineWidth || FALLBACK_TIMELINE_WIDTH) - LAYOUT.leftColWidth;
  const weekendWidth = Math.round(WEEKEND_COLUMN_REM * rootFontSizePx);
  const uniformFit = resolveColumnFit(availableWidth, ui.zoom);
  const fit =
    minimiseWeekends && uniformFit.dayWidth > weekendWidth
      ? resolveColumnFit(availableWidth, ui.zoom, weekendWidth)
      : uniformFit;
  const dayWidth = fit.dayWidth;
  const { start, end } = visibleRange(ui);
  const days = useMemo(() => eachDayISO(start, end), [start, end]);
  const geom = useMemo(
    () =>
      buildColumnGeometry(days, dayWidth, {
        minimiseWeekends,
        weekendWidth,
        targetWeekWidth: fit.weekWidth,
      }),
    [days, dayWidth, minimiseWeekends, weekendWidth, fit.weekWidth],
  );

  const focusX = geom.xForDateInGeom(ui.focusDate);
  const focusXRef = useRef(focusX);
  const previousScrollLeftRef = useRef<number | null>(null);
  // Recenter consumes this ref in a later layout effect from the same commit. Update it here,
  // before that consumer runs, so a simultaneous origin/focus/token change cannot use the prior
  // geometry's offset. Keeping the ref avoids making ordinary geometry changes trigger recentering.
  useLayoutEffect(() => {
    focusXRef.current = focusX;
  }, [focusX]);

  const prevGeomRef = useRef(geom);
  const prevDaysRef = useRef(days);
  const prevZoomRef = useRef(ui.zoom);
  const prevRecenterRef = useRef(ui.recenterToken);
  useLayoutEffect(() => {
    if (scrollRaf.current) {
      cancelAnimationFrame(scrollRaf.current);
      scrollRaf.current = 0;
    }
    clearTimeout(snapTimer.current);
    snapTimer.current = 0;

    const previousGeom = prevGeomRef.current;
    const previousDays = prevDaysRef.current;
    const previousZoom = prevZoomRef.current;
    const previousRecenter = prevRecenterRef.current;
    prevGeomRef.current = geom;
    prevDaysRef.current = days;
    prevZoomRef.current = ui.zoom;
    prevRecenterRef.current = ui.recenterToken;

    const el = scrollRef.current;
    if (!el || !didScroll.current || previousGeom === geom || previousGeom.totalWidth <= 0) return;
    if (ui.recenterToken !== previousRecenter) return;

    const leftDate = leftEdgeDate(previousGeom, days, el.scrollLeft);
    const navigationChanged = ui.zoom !== previousZoom || days !== previousDays;
    const targetDate = navigationChanged ? startOfWeekISO(leftDate, calendarWeekStartsOn) : leftDate;
    setScrollLeft(el, Math.max(0, geom.xForDateInGeom(targetDate)));
  }, [geom, days, ui.zoom, ui.recenterToken, calendarWeekStartsOn]);

  useEffect(() => {
    if (didScroll.current || !scrollRef.current || timelineWidth === 0) return;
    setScrollLeft(scrollRef.current, focusXRef.current);
    didScroll.current = true;
  }, [timelineWidth]);

  useLayoutEffect(() => {
    if (ui.recenterToken === 0 || !scrollRef.current) return;
    setScrollLeft(scrollRef.current, focusXRef.current);
  }, [ui.recenterToken]);

  const onScroll = useCallback(() => {
    const current = scrollRef.current;
    if (current) publishScrollLeft(current);
    if (scrollRaf.current) return;
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = 0;
      const el = scrollRef.current;
      if (!el) return;
      // Vertical windowing follows the viewport during a drag so newly visible rows can become
      // drop targets. SchedulerGrid separately pins the source row to keep gesture ownership.
      setScrollTop(el.scrollTop);
      const horizontalChanged = previousScrollLeftRef.current !== el.scrollLeft;
      previousScrollLeftRef.current = el.scrollLeft;
      // Horizontal state and idle snapping remain frozen until the drag ends: changing the date
      // geometry underneath a pointer gesture would change its meaning mid-flight.
      if (useStore.getState().draggingAllocationId !== null || !horizontalChanged) return;
      // indexAtScroll, not indexAt: it owns the HiDPI sub-pixel rounding every scroll-position
      // read needs (see its doc comment / weekSnap.ts's "SUB-PIXEL ROUNDING" note).
      setLeftEdgeIdx(geom.indexAtScroll(el.scrollLeft));

      if (!snapToWeekStart) return;
      clearTimeout(snapTimer.current);
      snapTimer.current = window.setTimeout(() => {
        const node = scrollRef.current;
        if (!node || useStore.getState().draggingAllocationId !== null) return;
        const target = weekStartSnapTarget(geom, days, node.scrollLeft, calendarWeekStartsOn);
        if (target !== null) setScrollLeft(node, target);
      }, WEEK_SNAP_IDLE_MS);
    });
  }, [geom, days, snapToWeekStart, calendarWeekStartsOn]);

  useEffect(
    () => () => {
      if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current);
      clearTimeout(snapTimer.current);
    },
    [],
  );

  const dragging = useStore((state) => state.draggingAllocationId !== null);
  useEffect(() => {
    if (!dragging && scrollRef.current) {
      setScrollTop(scrollRef.current.scrollTop);
      setLeftEdgeIdx(geom.indexAtScroll(scrollRef.current.scrollLeft));
    }
  }, [dragging, geom]);

  const visibleStartDate = useCallback((): ISODate => {
    const el = scrollRef.current;
    // Unmeasured container (jsdom / before first paint) → the window's first day, as before.
    return (el ? leftEdgeDate(geom, days, el.scrollLeft) : days[0]) ?? ui.originDate;
  }, [geom, days, ui.originDate]);

  return {
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
  };
}
