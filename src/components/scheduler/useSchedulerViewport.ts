import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from "react";
import { eachDayISO, startOfWeekISO } from "@capacitylens/shared/lib/dateMath";
import type { ISODate } from "@capacitylens/shared/types/entities";
import {
  FALLBACK_TIMELINE_WIDTH,
  WEEK_SNAP_IDLE_MS,
  WEEKEND_COLUMN_REM,
  resolveColumnFit,
} from "../../lib/schedulerConfig";
import { buildVisibleRange } from "../../store/selectors";
import { useStore, type SchedulerUI } from "../../store/useStore";
import { buildColumnGeometry, resolveLeftEdgeDate } from "./columnGeometry";
import { LAYOUT } from "./layout";
import { resolveWeekStartSnapTarget } from "./resolveWeekStartSnapTarget";

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

function disconnectResizeObserver(observer: ResizeObserver, timer: number) {
  clearTimeout(timer);
  observer.disconnect();
}

function useTimelineMeasurements(scrollRef: RefObject<HTMLDivElement | null>) {
  const [timelineWidth, setTimelineWidth] = useState(0);
  const [timelineHeight, setTimelineHeight] = useState(0);
  const [rootFontSizePx, setRootFontSizePx] = useState(16);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    let measuredWidth = -1;
    let measuredHeight = -1;
    let measuredRootFontSize = -1;
    const readMeasurements = () => ({
      width: element.clientWidth,
      height: element.clientHeight,
      rootFontSize: parseFloat(getComputedStyle(document.documentElement).fontSize) || 16,
    });
    const measure = () => {
      const { width, height, rootFontSize } = readMeasurements();
      if (width !== measuredWidth) setTimelineWidth((measuredWidth = width));
      if (height !== measuredHeight) setTimelineHeight((measuredHeight = height));
      if (rootFontSize !== measuredRootFontSize) setRootFontSizePx((measuredRootFontSize = rootFontSize));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    let resizeTimer = 0;
    const observer = new ResizeObserver(() => {
      const { width, height, rootFontSize } = readMeasurements();
      if (width === measuredWidth && height === measuredHeight && rootFontSize === measuredRootFontSize) return;
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(measure, 0);
    });
    observer.observe(element);
    return () => disconnectResizeObserver(observer, resizeTimer);
  }, [scrollRef]);
  return { timelineWidth, timelineHeight, rootFontSizePx };
}

function useStickyHeaderHeight(headerRef: RefObject<HTMLDivElement | null>) {
  const [height, setHeight] = useState(LAYOUT.headerHeight);
  useLayoutEffect(() => {
    const element = headerRef.current;
    if (!element) return;
    let measuredHeight = -1;
    const measure = () => {
      const nextHeight = element.offsetHeight || LAYOUT.headerHeight;
      if (nextHeight === measuredHeight) return;
      measuredHeight = nextHeight;
      setHeight(nextHeight);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    let resizeTimer = 0;
    const observer = new ResizeObserver(() => {
      if ((element.offsetHeight || LAYOUT.headerHeight) === measuredHeight) return;
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(measure, 0);
    });
    observer.observe(element);
    return () => {
      clearTimeout(resizeTimer);
      observer.disconnect();
    };
  }, [headerRef]);
  return height;
}

function useViewportGeometry({
  ui,
  minimiseWeekends,
  timelineWidth,
  rootFontSizePx,
}: Pick<SchedulerViewportOptions, "ui" | "minimiseWeekends"> & { timelineWidth: number; rootFontSizePx: number }) {
  const availableWidth = (timelineWidth || FALLBACK_TIMELINE_WIDTH) - LAYOUT.leftColWidth;
  const weekendWidth = Math.round(WEEKEND_COLUMN_REM * rootFontSizePx);
  const uniformFit = resolveColumnFit(availableWidth, ui.zoom);
  const fit =
    minimiseWeekends && uniformFit.dayWidth > weekendWidth
      ? resolveColumnFit(availableWidth, ui.zoom, weekendWidth)
      : uniformFit;
  const { start, end } = buildVisibleRange(ui);
  const days = useMemo(() => eachDayISO(start, end), [start, end]);
  const geometry = useMemo(
    () =>
      buildColumnGeometry(days, fit.dayWidth, {
        minimiseWeekends,
        weekendWidth,
        targetWeekWidth: fit.weekWidth,
      }),
    [days, fit.dayWidth, minimiseWeekends, weekendWidth, fit.weekWidth],
  );
  return { start, end, days, dayWidth: fit.dayWidth, geometry };
}

interface ViewportAlignmentInput {
  scrollRef: RefObject<HTMLDivElement | null>;
  didScrollRef: MutableRefObject<boolean>;
  scrollRafRef: MutableRefObject<number>;
  snapTimerRef: MutableRefObject<number>;
  geometry: ReturnType<typeof buildColumnGeometry>;
  days: ISODate[];
  ui: SchedulerUI;
  calendarWeekStartsOn: 0 | 1;
  timelineWidth: number;
}

function useViewportAlignment(input: ViewportAlignmentInput) {
  const { scrollRef, didScrollRef, scrollRafRef, snapTimerRef } = input;
  const { geometry, days, ui } = input;
  const { calendarWeekStartsOn, timelineWidth } = input;
  const focusX = geometry.xForDateInGeom(ui.focusDate);
  const focusXRef = useRef(focusX);
  const previousScrollLeftRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    focusXRef.current = focusX;
  }, [focusX]);
  const previousGeometryRef = useRef(geometry);
  const previousDaysRef = useRef(days);
  const previousZoomRef = useRef(ui.zoom);
  const previousRecenterRef = useRef(ui.recenterToken);
  useLayoutEffect(() => {
    if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = 0;
    clearTimeout(snapTimerRef.current);
    snapTimerRef.current = 0;
    const previousGeom = previousGeometryRef.current;
    const previousDays = previousDaysRef.current;
    const previousZoom = previousZoomRef.current;
    const previousRecenter = previousRecenterRef.current;
    previousGeometryRef.current = geometry;
    previousDaysRef.current = days;
    previousZoomRef.current = ui.zoom;
    previousRecenterRef.current = ui.recenterToken;
    const element = scrollRef.current;
    if (!element || !didScrollRef.current || previousGeom === geometry || previousGeom.totalWidth <= 0) return;
    if (ui.recenterToken !== previousRecenter) return;
    const leftDate = resolveLeftEdgeDate(previousGeom, days, element.scrollLeft);
    if (leftDate === undefined) return;
    const navigationChanged = ui.zoom !== previousZoom || days !== previousDays;
    const targetDate = navigationChanged ? startOfWeekISO(leftDate, calendarWeekStartsOn) : leftDate;
    setScrollLeft(element, Math.max(0, geometry.xForDateInGeom(targetDate)));
  }, [
    geometry,
    days,
    ui.zoom,
    ui.recenterToken,
    calendarWeekStartsOn,
    didScrollRef,
    scrollRafRef,
    scrollRef,
    snapTimerRef,
  ]);
  useEffect(() => {
    if (didScrollRef.current || !scrollRef.current || timelineWidth === 0) return;
    setScrollLeft(scrollRef.current, focusXRef.current);
    didScrollRef.current = true;
  }, [timelineWidth, didScrollRef, scrollRef]);
  useLayoutEffect(() => {
    if (ui.recenterToken === 0 || !scrollRef.current) return;
    setScrollLeft(scrollRef.current, focusXRef.current);
  }, [ui.recenterToken, scrollRef]);
  return previousScrollLeftRef;
}

interface ViewportScrollingInput {
  scrollRef: RefObject<HTMLDivElement | null>;
  scrollRafRef: MutableRefObject<number>;
  snapTimerRef: MutableRefObject<number>;
  previousScrollLeftRef: MutableRefObject<number | null>;
  geometry: ReturnType<typeof buildColumnGeometry>;
  days: ISODate[];
  ui: SchedulerUI;
  snapToWeekStart: boolean;
  calendarWeekStartsOn: 0 | 1;
  setScrollTop: Dispatch<SetStateAction<number>>;
  setLeftEdgeIndex: Dispatch<SetStateAction<number>>;
}

function useSettledScrollState(input: ViewportScrollingInput) {
  const { scrollRef, scrollRafRef, snapTimerRef, geometry, setScrollTop, setLeftEdgeIndex } = input;
  useEffect(
    () => () => {
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
      clearTimeout(snapTimerRef.current);
    },
    [scrollRafRef, snapTimerRef],
  );
  const dragging = useStore((state) => state.draggingAllocationId !== null);
  useEffect(() => {
    if (!dragging && scrollRef.current) {
      setScrollTop(scrollRef.current.scrollTop);
      setLeftEdgeIndex(geometry.indexAtScroll(scrollRef.current.scrollLeft));
    }
  }, [dragging, geometry, scrollRef, setLeftEdgeIndex, setScrollTop]);
}

function useVisibleStartDate(input: ViewportScrollingInput) {
  const { scrollRef, geometry, days, ui } = input;
  return useCallback((): ISODate => {
    const element = scrollRef.current;
    return (element ? resolveLeftEdgeDate(geometry, days, element.scrollLeft) : days[0]) ?? ui.originDate;
  }, [geometry, days, ui.originDate, scrollRef]);
}

function useViewportScrolling(input: ViewportScrollingInput) {
  const {
    scrollRef,
    scrollRafRef,
    snapTimerRef,
    previousScrollLeftRef,
    geometry,
    days,
    snapToWeekStart,
    calendarWeekStartsOn,
    setScrollTop,
    setLeftEdgeIndex,
  } = input;
  const onScroll = useCallback(() => {
    const current = scrollRef.current;
    if (current) publishScrollLeft(current);
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      const element = scrollRef.current;
      if (!element) return;
      setScrollTop(element.scrollTop);
      const horizontalChanged = previousScrollLeftRef.current !== element.scrollLeft;
      previousScrollLeftRef.current = element.scrollLeft;
      if (useStore.getState().draggingAllocationId !== null || !horizontalChanged) return;
      setLeftEdgeIndex(geometry.indexAtScroll(element.scrollLeft));
      if (!snapToWeekStart) return;
      clearTimeout(snapTimerRef.current);
      snapTimerRef.current = window.setTimeout(() => {
        const node = scrollRef.current;
        if (!node || useStore.getState().draggingAllocationId !== null) return;
        const target = resolveWeekStartSnapTarget({
          geom: geometry,
          days,
          scrollLeft: node.scrollLeft,
          weekStartsOn: calendarWeekStartsOn,
        });
        if (target !== null) setScrollLeft(node, target);
      }, WEEK_SNAP_IDLE_MS);
    });
  }, [
    geometry,
    days,
    snapToWeekStart,
    calendarWeekStartsOn,
    previousScrollLeftRef,
    scrollRafRef,
    scrollRef,
    setLeftEdgeIndex,
    setScrollTop,
    snapTimerRef,
  ]);
  useSettledScrollState(input);
  const readVisibleStartDate = useVisibleStartDate(input);
  return { onScroll, readVisibleStartDate };
}

interface ViewportProtocolInput extends ViewportAlignmentInput {
  snapToWeekStart: boolean;
  setScrollTop: Dispatch<SetStateAction<number>>;
  setLeftEdgeIndex: Dispatch<SetStateAction<number>>;
}

function useViewportProtocol(input: ViewportProtocolInput) {
  const previousScrollLeftRef = useViewportAlignment(input);
  return useViewportScrolling({ ...input, previousScrollLeftRef });
}

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
  const didScrollRef = useRef(false);
  const scrollRafRef = useRef(0);
  const snapTimerRef = useRef(0);
  const stickyHeaderHeight = useStickyHeaderHeight(headerRef);
  const { timelineWidth, timelineHeight, rootFontSizePx } = useTimelineMeasurements(scrollRef);
  const [scrollTop, setScrollTop] = useState(0);
  const [leftEdgeIndex, setLeftEdgeIndex] = useState(-1);

  const { start, end, days, dayWidth, geometry } = useViewportGeometry({
    ui,
    minimiseWeekends,
    timelineWidth,
    rootFontSizePx,
  });

  const { onScroll, readVisibleStartDate } = useViewportProtocol({
    scrollRef,
    didScrollRef,
    scrollRafRef,
    snapTimerRef,
    geometry,
    days,
    ui,
    snapToWeekStart,
    calendarWeekStartsOn,
    setScrollTop,
    setLeftEdgeIndex,
    timelineWidth,
  });

  return {
    scrollRef,
    headerRef,
    stickyHeaderHeight,
    timelineWidth,
    timelineHeight,
    scrollTop,
    leftEdgeIdx: leftEdgeIndex,
    start,
    end,
    days,
    dayWidth,
    geom: geometry,
    onScroll,
    visibleStartDate: readVisibleStartDate,
  };
}
