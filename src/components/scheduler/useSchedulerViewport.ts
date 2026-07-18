import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { eachDayISO, startOfWeekISO } from '@capacitylens/shared/lib/dateMath'
import type { ISODate } from '@capacitylens/shared/types/entities'
import {
  FALLBACK_TIMELINE_WIDTH,
  WEEK_SNAP_IDLE_MS,
  WEEKEND_COLUMN_REM,
  resolveDayWidth,
} from '../../lib/schedulerConfig'
import { visibleRange } from '../../store/selectors'
import { useStore, type SchedulerUI } from '../../store/useStore'
import { buildColumnGeometry } from './columnGeometry'
import { LAYOUT } from './layout'
import { weekStartSnapTarget } from './weekSnap'

interface SchedulerViewportOptions {
  ui: SchedulerUI
  minimiseWeekends: boolean
  snapToWeekStart: boolean
  calendarWeekStartsOn: 0 | 1
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
  const scrollRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const didScroll = useRef(false)
  const scrollRaf = useRef(0)
  const snapTimer = useRef(0)
  const [stickyHeaderHeight, setStickyHeaderHeight] = useState(LAYOUT.headerHeight)
  const [timelineWidth, setTimelineWidth] = useState(0)
  const [timelineHeight, setTimelineHeight] = useState(0)
  const [rootFontSizePx, setRootFontSizePx] = useState(16)
  const [scrollTop, setScrollTop] = useState(0)
  const [leftEdgeIdx, setLeftEdgeIdx] = useState(-1)

  // Measure before paint so remounting the schedule never flashes fallback geometry.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => {
      setTimelineWidth(el.clientWidth)
      setTimelineHeight(el.clientHeight)
      setRootFontSizePx(parseFloat(getComputedStyle(document.documentElement).fontSize) || 16)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    let raf = 0
    const onResize = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measure)
    }
    const observer = new ResizeObserver(onResize)
    observer.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [])

  // AllocationBar uses the measured sticky height as its focus-obscuring margin.
  useLayoutEffect(() => {
    const el = headerRef.current
    if (!el) return
    const measure = () => setStickyHeaderHeight(el.offsetHeight || LAYOUT.headerHeight)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const availableWidth = (timelineWidth || FALLBACK_TIMELINE_WIDTH) - LAYOUT.leftColWidth
  const weekendWidth = Math.round(WEEKEND_COLUMN_REM * rootFontSizePx)
  const uniformDayWidth = resolveDayWidth(availableWidth, ui.zoom)
  const dayWidth =
    minimiseWeekends && uniformDayWidth > weekendWidth
      ? resolveDayWidth(availableWidth, ui.zoom, weekendWidth)
      : uniformDayWidth
  const { start, end } = visibleRange(ui)
  const days = useMemo(() => eachDayISO(start, end), [start, end])
  const geom = useMemo(
    () => buildColumnGeometry(days, dayWidth, { minimiseWeekends, weekendWidth }),
    [days, dayWidth, minimiseWeekends, weekendWidth],
  )

  const focusX = geom.xForDateInGeom(ui.focusDate)
  const focusXRef = useRef(focusX)
  useEffect(() => {
    focusXRef.current = focusX
  })

  const prevGeomRef = useRef(geom)
  const prevDaysRef = useRef(days)
  const prevZoomRef = useRef(ui.zoom)
  const prevRecenterRef = useRef(ui.recenterToken)
  useLayoutEffect(() => {
    if (scrollRaf.current) {
      cancelAnimationFrame(scrollRaf.current)
      scrollRaf.current = 0
    }
    clearTimeout(snapTimer.current)
    snapTimer.current = 0

    const previousGeom = prevGeomRef.current
    const previousDays = prevDaysRef.current
    const previousZoom = prevZoomRef.current
    const previousRecenter = prevRecenterRef.current
    prevGeomRef.current = geom
    prevDaysRef.current = days
    prevZoomRef.current = ui.zoom
    prevRecenterRef.current = ui.recenterToken

    const el = scrollRef.current
    if (!el || !didScroll.current || previousGeom === geom || previousGeom.totalWidth <= 0) return
    if (ui.recenterToken !== previousRecenter) return

    const leftDate = days[previousGeom.indexAt(Math.round(el.scrollLeft))] ?? days[0]
    const navigationChanged = ui.zoom !== previousZoom || days !== previousDays
    const targetDate = navigationChanged
      ? startOfWeekISO(leftDate, calendarWeekStartsOn)
      : leftDate
    el.scrollLeft = geom.xForDateInGeom(targetDate)
  }, [geom, days, ui.zoom, ui.recenterToken, calendarWeekStartsOn])

  useEffect(() => {
    if (didScroll.current || !scrollRef.current || timelineWidth === 0) return
    scrollRef.current.scrollLeft = focusXRef.current
    didScroll.current = true
  }, [timelineWidth])

  useLayoutEffect(() => {
    if (ui.recenterToken === 0 || !scrollRef.current) return
    scrollRef.current.scrollLeft = focusXRef.current
  }, [ui.recenterToken])

  const onScroll = useCallback(() => {
    if (scrollRaf.current) return
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = 0
      // Freezing re-windowing is load-bearing: unmounting the active bar would
      // tear down its document pointer listeners before the drop can commit.
      if (useStore.getState().draggingAllocationId !== null) return
      const el = scrollRef.current
      if (!el) return
      setScrollTop(el.scrollTop)
      setLeftEdgeIdx(geom.indexAt(el.scrollLeft))

      if (!snapToWeekStart) return
      clearTimeout(snapTimer.current)
      snapTimer.current = window.setTimeout(() => {
        const node = scrollRef.current
        if (!node || useStore.getState().draggingAllocationId !== null) return
        const target = weekStartSnapTarget(geom, days, node.scrollLeft, calendarWeekStartsOn)
        if (target !== null) node.scrollLeft = target
      }, WEEK_SNAP_IDLE_MS)
    })
  }, [geom, days, snapToWeekStart, calendarWeekStartsOn])

  useEffect(
    () => () => {
      if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current)
      clearTimeout(snapTimer.current)
    },
    [],
  )

  const dragging = useStore((state) => state.draggingAllocationId !== null)
  useEffect(() => {
    if (!dragging && scrollRef.current) {
      setScrollTop(scrollRef.current.scrollTop)
      setLeftEdgeIdx(geom.indexAt(scrollRef.current.scrollLeft))
    }
  }, [dragging, geom])

  const visibleStartDate = useCallback((): ISODate => {
    const el = scrollRef.current
    const index = el ? geom.indexAt(el.scrollLeft) : 0
    return days[index] ?? days[0] ?? ui.originDate
  }, [geom, days, ui.originDate])

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
    totalWidth: geom.totalWidth,
    onScroll,
    visibleStartDate,
  }
}
