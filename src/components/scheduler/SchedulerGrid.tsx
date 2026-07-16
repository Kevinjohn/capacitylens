import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { m } from '@/i18n'
import { hasActiveFilters, useStore } from '../../store/useStore'
import { useCanEdit } from '../../auth/permissionContext'
import { useActiveScopedData } from '../../store/useScopedData'
import { disciplinesEnabledFor, externalEnabledFor, internalColourModeFor, placeholdersEnabledFor, visibleRange } from '../../store/selectors'
import { addDaysISO, eachDayISO, startOfWeekISO, todayISO } from '@capacitylens/shared/lib/dateMath'
import { FALLBACK_TIMELINE_WIDTH, UTILIZATION_WINDOW_DAYS, WEEK_SNAP_IDLE_MS, WEEKEND_COLUMN_REM, resolveDayWidth } from '../../lib/schedulerConfig'
import { Avatar, EmptyState } from '../common/ui'
import { resourceDisplayName } from '../../lib/metadata'
import { Icon } from '../common/Icon'
import { LAYOUT } from './layout'
import { DateHeader } from './DateHeader'
import { ResourceLane } from './ResourceLane'
import { AllocationModal } from './AllocationModal'
import { TimeOffForm } from '../timeoff/TimeOffForm'
import { buildColumnGeometry } from './columnGeometry'
import { weekStartSnapTarget } from './weekSnap'
import { buildSchedulerModel } from './schedulerModel'
import { buildLayout, windowFromLayout } from './virtualWindow'
import type { GroupModel, RowModel } from './schedulerModel'
import { isCapacityTracked, isExternalResource } from '@capacitylens/shared/types/entities'
import type { ID, ISODate } from '@capacitylens/shared/types/entities'

type ModalState =
  | { kind: 'edit'; allocationId: ID }
  | { kind: 'create'; resourceId: ID; startDate: ISODate; endDate: ISODate }
  | { kind: 'timeoff'; resourceId: ID; startDate: ISODate; endDate: ISODate }

/**
 * The week-grid scheduler: the helicopter view of who's busy/free. Two non-obvious
 * mechanisms run here — read this before touching the scroll/render path.
 *
 * **1. Vertical virtualization.** The model (groups → rows) is flattened into one ordered
 * `items` list (group headers + the rows of expanded groups), then each item's height is
 * measured (`heights`), prefix-summed by `buildLayout`, and `windowFromLayout` picks the
 * on-screen slice for the current `scrollTop`/viewport height. Only that slice is in the DOM;
 * the rows above and below it are RESERVED by `topPad`/`bottomPad` spacer divs so the
 * scrollbar geometry stays correct (drop the spacers and the scroll height collapses, so the
 * thumb and every offset would be wrong). `heights`/`layout` are memoised on the item set, so a
 * scroll frame only runs the cheap edge-scan, not a full re-measure.
 *
 * **2. The drag-freeze (load-bearing).** While a bar is being dragged, `onScroll` SKIPS
 * `setScrollTop` (it reads `draggingAllocationId` live via `getState` to dodge a stale closure),
 * so the visible window does not re-window mid-gesture. This is not a perf nicety: re-windowing
 * could unmount the dragged `AllocationBar` and tear down its document pointer listeners,
 * orphaning the live cross-row drag so the drop never commits. When the drag ENDS, a one-shot
 * effect (keyed on `dragging`) catches the window up to whatever scrolling happened while frozen.
 */
export function SchedulerGrid() {
  const navigate = useNavigate()
  const data = useActiveScopedData()
  // Viewer read-only (P1.12): when the active account's role is a viewer, the grid is display-only —
  // no row "+" create, no lane draw-to-create, no bar edit/drag/resize (the bar gating lives in
  // AllocationBar; the draw/create gating is the conditional onDraw/onEdit + the hidden "+" below).
  // null/owner/admin/editor (incl. OFF/local) → fully editable, byte-identical to today. The server
  // 403 backstops a write regardless; this is the UX read-only surface.
  const canEdit = useCanEdit()
  const ui = useStore((s) => s.ui)
  // Utilisation display toggles (Settings → Utilisation). Each gates one of the three
  // utilisation figures: total (header), discipline (group header), personal (per row).
  const utilizationPrefs = useStore((s) => s.utilizationPrefs)
  // Device-global display pref (default on): narrow the weekend columns. Drives the geometry below.
  const minimiseWeekends = useStore((s) => s.minimiseWeekends)
  // Device-global display pref (default on): after a FREE scroll settles, floor the left edge back
  // to the current week's first day (the scroll-idle snap in onScroll below). FREE SCROLL ONLY —
  // the navigation snap (zoom / Prev-Next / date-picker, Feature 1) is always on, independent of this.
  const snapToWeekStart = useStore((s) => s.snapToWeekStart)
  // Per-account display pref (default OFF): when off, placeholder ("slot") rows are hidden from
  // the schedule (and dropped from utilisation) by buildSchedulerModel's resourceVisible filter.
  const placeholdersEnabled = useStore((s) => placeholdersEnabledFor(s.data, s.activeAccountId))
  // Per-account display pref (default OFF): when off, external / 3rd-party rows are hidden from the
  // schedule (and their now-empty band header is dropped) by buildSchedulerModel's resourceVisible filter.
  const externalEnabled = useStore((s) => externalEnabledFor(s.data, s.activeAccountId))
  // Account-level: when disciplines are off, the schedule renders flat (no discipline
  // bands) and the discipline filter is ignored (see buildSchedulerModel + items below).
  const disciplinesEnabled = useStore((s) => disciplinesEnabledFor(s.data, s.activeAccountId))
  // Per-account Internal work colour preference. Grey is the absent/default mode; palette restores
  // saved project colours without changing the underlying project records.
  const internalColourMode = useStore((s) => internalColourModeFor(s.data, s.activeAccountId))
  const toggleGroup = useStore((s) => s.toggleGroup)
  const clearFilters = useStore((s) => s.clearFilters)
  // WCAG 4.1.3: the latest screen-reader capacity announcement, set by AllocationBar after a
  // KEYBOARD-committed move/resize. Rendered ONCE below in a polite aria-live region. It changes
  // only on a keyboard edit (not a scroll/zoom/modal/render), so subscribing here adds no hot-path
  // re-render; pointer drags never set it, so they stay silent for screen readers (sighted feedback).
  const srAnnouncement = useStore((s) => s.srAnnouncement)
  const [modal, setModal] = useState<ModalState | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // The sticky date-header row. Its rendered height is NOT LAYOUT.headerHeight (44 is only a
  // min-height FLOOR): the two-tier header (month band + week/day band) renders taller — ~51px at
  // zoom 4, ~67px at zoom 2, and more again when the user bumps their font size. We measure the
  // ACTUAL height and publish it (--sched-sticky-top) so a focused near-top bar's scroll-margin-top
  // reserves the real chrome, not the floor (WCAG 2.4.11). See stickyHeaderHeight below.
  const headerRef = useRef<HTMLDivElement>(null)
  const [stickyHeaderHeight, setStickyHeaderHeight] = useState(LAYOUT.headerHeight)
  const didScroll = useRef(false)
  const [timelineWidth, setTimelineWidth] = useState(0)
  const [timelineHeight, setTimelineHeight] = useState(0) // viewport height for row virtualization
  // Root font size (px) for resolving the rem-based weekend column width. Re-read on the same
  // ResizeObserver tick as the container, so a font-size / zoom change reflows the columns too.
  const [rootFontSizePx, setRootFontSizePx] = useState(16)
  const [scrollTop, setScrollTop] = useState(0)
  // The left-edge DAY index of the visible window, DAY-QUANTIZED: updated only when the
  // scroll left edge crosses into a new day column (or zoom changes `days`), NOT on every
  // scroll pixel. It anchors the visible-window utilisation %; quantizing here keeps the heavy
  // model rebuild off the per-pixel scroll path (a pixel of horizontal scroll that stays in the
  // same column leaves leftEdgeIdx unchanged → React bails the re-render). Starts at -1 ("not yet
  // measured") so the % anchors at the focus date until the first real scroll settles (at first
  // paint scrollLeft=0 points at the past-buffer origin, NOT today — see visibleWindow below).
  const [leftEdgeIdx, setLeftEdgeIdx] = useState(-1)
  const scrollRaf = useRef(0)
  // Debounce timer for the scroll-idle "snap to week start" floor (armed in onScroll). 0 = idle.
  const snapTimer = useRef(0)

  // Measure the scroll container so the day-column width can fit ui.zoom weeks (and
  // the height drives row virtualization). useLayoutEffect (NOT useEffect) so the measure runs
  // synchronously BEFORE the browser paints: on mount — and on every remount, e.g. returning to
  // the Schedule tab — `timelineWidth` starts at 0, so a plain post-paint effect would let the
  // first frame render at FALLBACK_TIMELINE_WIDTH geometry and then snap to the measured width
  // (a visible flash). Measuring pre-paint collapses that to one correct frame. (Client-only SPA,
  // so there's no SSR useLayoutEffect warning; under jsdom clientWidth is 0 → the same fallback
  // path the tests already exercise.)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => {
      setTimelineWidth(el.clientWidth)
      setTimelineHeight(el.clientHeight)
      // getComputedStyle().fontSize is '' in jsdom/SSR → parseFloat NaN → fall back to 16px.
      setRootFontSizePx(parseFloat(getComputedStyle(document.documentElement).fontSize) || 16)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    // rAF-throttle so a live window drag-resize coalesces to one rebuild per frame.
    let raf = 0
    const onResize = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measure)
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  // Measure the sticky date-header's ACTUAL rendered height and publish it as a CSS variable
  // (--sched-sticky-top on the scroll container, read by every AllocationBar's scroll-margin-top).
  // LAYOUT.headerHeight (44) is only the row's min-height FLOOR; the two-tier header renders taller
  // (~51px at zoom 4, ~67px at zoom 2, more again at a larger font size), so a focused near-top bar
  // that reserved only 44px would land partly behind the header (WCAG 2.4.11 Focus Not Obscured).
  // The height changes only on a zoom flip / font-size change (rare), so a ResizeObserver here is
  // not a hot path; it's measured pre-paint (useLayoutEffect) so the var is correct on the first
  // frame, and the observer is disconnected on unmount. jsdom reports offsetHeight 0 → we keep the
  // headerHeight floor (the var still resolves to a sane value).
  useLayoutEffect(() => {
    const el = headerRef.current
    if (!el) return
    const measure = () => setStickyHeaderHeight(el.offsetHeight || LAYOUT.headerHeight)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const avail = (timelineWidth || FALLBACK_TIMELINE_WIDTH) - LAYOUT.leftColWidth
  // Bare-minimum weekend column width, rem-based so it tracks font size, ROUNDED to a whole
  // pixel. Integer widths keep every ColumnGeometry offset — and the scrollLeft we set from it —
  // a whole number, so the zoom scroll-anchor's date round-trip is exact; a fractional width
  // (22.39) made offsets the browser couldn't store exactly, drifting the left-edge date back
  // onto the narrow weekend column on every zoom flip.
  const weekendWidth = Math.round(WEEKEND_COLUMN_REM * rootFontSizePx)
  // Fit ui.zoom weeks. When minimise is actually narrowing the weekends (the uniform column would
  // be wider than a weekend column), use the weekend-aware fit so a "1-week" view shows ~1 week —
  // the narrowed Sat/Sun would otherwise leave the right edge under-filled (a "1-week" view would
  // creep to ~1.5 weeks). Off / coarse zoom falls back to the uniform 7-equal-columns fit.
  const uniformDayWidth = resolveDayWidth(avail, ui.zoom)
  const dayWidth =
    minimiseWeekends && uniformDayWidth > weekendWidth ? resolveDayWidth(avail, ui.zoom, weekendWidth) : uniformDayWidth

  const { start, end } = visibleRange(ui)
  const days = useMemo(() => eachDayISO(start, end), [start, end])
  // One ColumnGeometry owns every px↔day↔date conversion (bar/header/lane/today/scroll/drag),
  // so the narrowed weekend columns don't leak the old uniform-grid assumption anywhere.
  const geom = useMemo(
    () => buildColumnGeometry(days, dayWidth, { minimiseWeekends, weekendWidth }),
    [days, dayWidth, minimiseWeekends, weekendWidth],
  )
  const totalWidth = geom.totalWidth

  const calendarTimeZone = useStore((s) => s.data.accounts.find((a) => a.id === s.activeAccountId)?.timezone ?? 'Etc/GMT')
  const calendarWeekStartsOn = useStore((s) => s.data.accounts.find((a) => a.id === s.activeAccountId)?.weekStartsOn ?? 1)
  const today = todayISO(calendarTimeZone)
  // FIXED forward window from today (overStart..overEnd): drives ONLY the `overSoon` red flag — a
  // near-term, zoom/pan-INDEPENDENT "over soon" radar, so the per-resource overbooked warning fires
  // regardless of the visible range. Kept separate from the displayed % (which follows the view).
  const overStart = today
  const overEnd = addDaysISO(today, UTILIZATION_WINDOW_DAYS - 1)

  // VISIBLE window [visStart, visEnd]: drives the DISPLAYED utilisation % (per-person, per-discipline
  // avg, overall). The visible span is `ui.zoom * 7` calendar days anchored at the scroll left-edge
  // day; the inclusive end is `+ (zoom*7 - 1)` — a 1-week view is the 7 inclusive days [L, L+6], not
  // +7 (8 days). The end is CLAMPED to the last timeline day so the window never reads past `days[]`.
  // Day-quantized via leftEdgeIdx so a scroll within a column doesn't rebuild the model.
  const { visStart, visEnd } = useMemo(() => {
    // Before the first scroll settles (leftEdgeIdx === -1), anchor at the focus date (today by
    // default) — NOT days[0], which is the PAST_BUFFER_DAYS origin behind today, so the initial
    // numbers stay sensible (anchored at/after today). Clamp the index into the day array.
    const lastIdx = days.length - 1
    const focusIdx = days.indexOf(ui.focusDate)
    const rawIdx = leftEdgeIdx >= 0 ? leftEdgeIdx : focusIdx >= 0 ? focusIdx : 0
    const startIdx = Math.min(Math.max(rawIdx, 0), Math.max(lastIdx, 0))
    const start = days[startIdx] ?? ui.focusDate
    // Inclusive end = start + (zoom*7 - 1), clamped to the last timeline day.
    const endIdx = Math.min(startIdx + ui.zoom * 7 - 1, lastIdx)
    const end = days[Math.max(endIdx, startIdx)] ?? start
    return { visStart: start, visEnd: end }
  }, [days, leftEdgeIdx, ui.zoom, ui.focusDate])

  // Human label for the visible span, used in the utilisation titles ("over the visible N week(s)").
  const visibleWeeksLabel =
    ui.zoom === 1 ? m.scheduler_visible_weeks_label_one({ count: ui.zoom }) : m.scheduler_visible_weeks_label_other({ count: ui.zoom })

  const blocksMode = useStore((s) => (s.data.accounts.find((a) => a.id === s.activeAccountId)?.schedulingMode ?? 'hourly') === 'blocks')

  const model = useMemo(
    () =>
      buildSchedulerModel(
        data,
        geom,
        days,
        visStart,
        visEnd,
        overStart,
        overEnd,
        ui.filters,
        disciplinesEnabled,
        placeholdersEnabled,
        externalEnabled,
        blocksMode,
        internalColourMode,
      ),
    [data, geom, days, visStart, visEnd, overStart, overEnd, ui.filters, disciplinesEnabled, placeholdersEnabled, externalEnabled, blocksMode, internalColourMode],
  )

  const todayX = today >= start && today <= end ? geom.xForDateInGeom(today) : null

  // Where the grid scrolls on a focus request (Today / jump-to-date). Held in a ref
  // so zoom/resize re-renders don't re-fire the recenter effect.
  const focusX = geom.xForDateInGeom(ui.focusDate)
  const focusXRef = useRef(focusX)
  useEffect(() => {
    focusXRef.current = focusX
  })

  // Re-position the left edge when the GEOMETRY changes (zoom click, Prev/Next pan, container
  // resize, or the minimise-weekends toggle): scrollLeft is pixels, so the same offset would
  // otherwise re-point at a different date. We read the date at the left edge — for a pan,
  // `prevGeom` is numerically identical to `geom` (the origin shifts a whole week, so the
  // weekday/width pattern is unchanged) and `days[idx]` reads the POST-pan date, so the single
  // `indexAt` formula gives the right left-edge date for both a zoom and a pan. Skipped until the
  // initial scroll has run (didScroll); the effect below (so it runs AFTER this skips on the
  // first-measure commit) owns the first real-width placement.
  //
  // Where it re-anchors depends on WHY the geometry changed:
  // - A zoom click OR a pan (`ui.zoom` or `days` reference changed) → snap the left edge to the
  //   WEEK START of the left-edge date (Feature 1, ALWAYS on). `panDays(±7)` in the store is
  //   unchanged — the week-snap happens here in the component.
  // - A pure container resize / minimise-weekends flip (geometry changed, but zoom AND days are
  //   the same) → preserve the EXACT left-edge date, so we don't yank a deliberately
  //   free-positioned view off the day the user parked it on.
  // - A goToDate / goToToday (recenterToken bumped) → do NOTHING here; the recenter effect below
  //   owns that placement (it scrolls to focusX = the already-week-snapped focusDate).
  const prevGeomRef = useRef(geom)
  const prevDaysRef = useRef(days)
  const prevZoomRef = useRef(ui.zoom)
  const prevRecenterRef = useRef(ui.recenterToken)
  useLayoutEffect(() => {
    // A scroll event from the OLD geometry may still have a queued rAF / idle-snap timer when a
    // zoom, pan or recenter changes the geometry. Letting that callback run would interpret the
    // NEW scrollLeft with OLD column widths and can jump the grid back to its buffered origin.
    // Cancel stale work before reading/repositioning the new geometry; the programmatic write
    // below emits a fresh scroll event whose callback closes over the current geometry.
    if (scrollRaf.current) {
      cancelAnimationFrame(scrollRaf.current)
      scrollRaf.current = 0
    }
    clearTimeout(snapTimer.current)
    snapTimer.current = 0
    const prevGeom = prevGeomRef.current
    const prevDays = prevDaysRef.current
    const prevZoom = prevZoomRef.current
    const prevRecenter = prevRecenterRef.current
    prevGeomRef.current = geom
    prevDaysRef.current = days
    prevZoomRef.current = ui.zoom
    prevRecenterRef.current = ui.recenterToken
    const el = scrollRef.current
    if (!el || !didScroll.current || prevGeom === geom || prevGeom.totalWidth <= 0) return
    // goToDate / goToToday bump recenterToken; the recenter effect below owns that placement
    // (it scrolls to the already-week-snapped focusDate). Don't fight it here.
    if (ui.recenterToken !== prevRecenter) return
    // Round scrollLeft before resolving the left-edge day: a HiDPI browser (Firefox especially,
    // devicePixelRatio > 1) can report a fractional scrollLeft a sub-pixel BELOW the integer column
    // boundary, which `indexAt` (strict floor) would resolve to the previous day — and the week-snap
    // below would then jump back a whole week. See weekSnap.ts for the full reasoning.
    const leftDate = days[prevGeom.indexAt(Math.round(el.scrollLeft))] ?? days[0]
    // Feature 1 (ALWAYS): a zoom click or a Prev/Next pan re-anchors the left edge to its WEEK
    // START. A pure container resize / minimise-weekends flip preserves the exact left-edge date.
    const snap = ui.zoom !== prevZoom || days !== prevDays
    const target = snap ? startOfWeekISO(leftDate, calendarWeekStartsOn) : leftDate
    el.scrollLeft = geom.xForDateInGeom(target)
  }, [geom, days, ui.zoom, ui.recenterToken, calendarWeekStartsOn])

  // Bring the focus date (today by default) flush to the left edge on first render —
  // the PAST_BUFFER_DAYS of history before it stay off-screen to the left, reachable
  // by scrolling. Only once the container has been MEASURED (timelineWidth > 0), so
  // the scroll uses the real dayWidth, not the fallback. Runs once (didScroll guard);
  // re-fires harmlessly until the real width arrives in jsdom/SSR where it never does.
  useEffect(() => {
    if (didScroll.current || !scrollRef.current || timelineWidth === 0) return
    scrollRef.current.scrollLeft = focusXRef.current
    didScroll.current = true
  }, [timelineWidth])

  // Re-centre when the user clicks Today / picks a date (which bumps recenterToken).
  const recenterToken = ui.recenterToken
  useLayoutEffect(() => {
    if (recenterToken === 0 || !scrollRef.current) return
    scrollRef.current.scrollLeft = focusXRef.current
  }, [recenterToken])

  const filtersActive = hasActiveFilters(ui.filters)

  // Stable callbacks so the memoised ResourceLane can skip re-rendering on
  // grid-level UI changes (e.g. opening a modal). setModal is referentially stable.
  const handleEdit = useCallback((allocationId: ID) => setModal({ kind: 'edit', allocationId }), [])
  const handleDraw = useCallback(
    (resourceId: ID, startDate: ISODate, endDate: ISODate) => {
      // Read the draw mode LIVE (getState) when the gesture FIRES, not via a closure over
      // ui.drawMode. That's load-bearing: closing over ui.drawMode would give handleDraw a fresh
      // reference on every toggle, which `onDraw` hands to every ResourceLane — failing their
      // React.memo and re-rendering every lane (and its bars) on a mode toggle. The mode that
      // matters is the one live at pointerup, which is exactly what getState() returns here, so
      // an EMPTY dep array keeps this callback referentially stable across a toggle. Time off is
      // meaningless for externals (no capacity), so a draw on their lane is a no-op rather than
      // opening a time-off form seeded with a resource the picker itself excludes.
      const drawMode = useStore.getState().ui.drawMode
      if (drawMode === 'timeoff') {
        const r = useStore.getState().data.resources.find((x) => x.id === resourceId)
        if (r && isExternalResource(r)) return
      }
      setModal({ kind: drawMode === 'timeoff' ? 'timeoff' : 'create', resourceId, startDate, endDate })
    },
    [],
  )

  // The date currently at the left edge of the viewport — what the "+" quick-create
  // should default to, so it lands where the user is looking (not always today). geom.indexAt
  // inverts the (possibly variable-width) columns and clamps into the window.
  const visibleStartDate = (): ISODate => {
    const el = scrollRef.current
    const idx = el ? geom.indexAt(el.scrollLeft) : 0
    return days[idx] ?? days[0] ?? ui.originDate
  }

  // Derived from the model only — memoise so opening a modal / measuring the
  // container (frequent re-renders) doesn't re-flatMap + re-reduce every row.
  const overallUtil = useMemo(() => {
    // Exclude external / 3rd-party rows: they carry no capacity (utilisation 0) and would
    // otherwise drag the headline average down.
    const rows = model.flatMap((g) => g.rows).filter((r) => isCapacityTracked(r.resource))
    return rows.length ? Math.round((rows.reduce((sum, r) => sum + r.utilization, 0) / rows.length) * 100) : 0
  }, [model])

  // Flatten the visible model into one ordered list of renderable items (group
  // headers + the rows of expanded groups) so the grid can window them vertically:
  // at small scale everything renders; past a viewport's worth, only the on-screen
  // slice is in the DOM (the rest is reserved by top/bottom spacers).
  type Item = { kind: 'group'; group: GroupModel } | { kind: 'row'; group: GroupModel; row: RowModel }
  const items = useMemo(() => {
    const out: Item[] = []
    for (const group of model) {
      // Disciplines off → render the rows flat (no group-header band, no collapse) — EXCEPT the
      // external band, which always keeps its header so it reads as a distinct band at the bottom
      // regardless of disciplines being on/off.
      if (!disciplinesEnabled && !group.external) {
        for (const row of group.rows) out.push({ kind: 'row', group, row })
        continue
      }
      out.push({ kind: 'group', group })
      if (!ui.collapsedGroups.includes(group.key)) for (const row of group.rows) out.push({ kind: 'row', group, row })
    }
    return out
  }, [model, ui.collapsedGroups, disciplinesEnabled])

  // Heights + their prefix-sum depend only on the item set (model/collapse), NOT on
  // scroll — memoise so a scroll frame only runs the cheap edge-scan in windowFromLayout.
  const heights = useMemo(
    () => items.map((it) => (it.kind === 'group' ? LAYOUT.groupHeaderHeight : it.row.rowHeight)),
    [items],
  )
  const layout = useMemo(() => buildLayout(heights), [heights])

  // Scroll a specific resource row into view when jumpToResource fires (command
  // palette "jump to person"). Mirrors the recenterToken pattern. Uses layout.tops
  // (prefix-sum of row heights) to find the vertical offset.
  const scrollToResource = ui.scrollToResource
  useEffect(() => {
    if (!scrollToResource || !scrollRef.current) return
    const idx = items.findIndex(
      (it) => it.kind === 'row' && it.row.resource.id === scrollToResource.id,
    )
    if (idx === -1) return
    const top = layout.tops[idx] ?? 0
    scrollRef.current.scrollTop = top
  }, [scrollToResource, items, layout])

  // Pin the dragged row while a gesture is live: a mid-drag vertical scroll must NOT
  // re-window, or it could unmount the dragged AllocationBar and tear down its document
  // pointer listeners (orphaning the drag, so the drop never commits). We FREEZE the scroll
  // input instead — onScroll skips setScrollTop while dragging — so the window stays put
  // until the drag ends, then a one-shot effect catches it up. `draggingAllocationId` is
  // transient store state.
  const dragging = useStore((s) => s.draggingAllocationId !== null)
  const { first, last, topPad, bottomPad } = windowFromLayout(layout, heights, scrollTop, timelineHeight)
  const visible = items.slice(first, last + 1)

  // rAF-coalesced scroll → recompute the vertical row window AND the day-quantized horizontal
  // left edge. setScrollTop / setLeftEdgeIdx with an unchanged value is a no-op (React bails the
  // re-render), so a horizontal scroll that stays in the same day column rebuilds NOTHING — the
  // visible-window % only recomputes when the left-edge DAY actually changes (no per-pixel model
  // rebuild / scroll jank).
  const onScroll = () => {
    if (scrollRaf.current) return
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = 0
      // Don't re-window mid-drag — it could unmount the dragged row and orphan the gesture.
      // Read draggingAllocationId LIVE (getState) to avoid a stale closure.
      if (useStore.getState().draggingAllocationId !== null) return
      const el = scrollRef.current
      if (!el) return
      setScrollTop(el.scrollTop)
      setLeftEdgeIdx(geom.indexAt(el.scrollLeft))
      // Scroll-idle "snap to week start" floor — device-global pref (default on; FREE SCROLL ONLY,
      // independent of Feature 1's always-on navigation snap). When on, debounce until the scroll
      // settles, then floor the left edge to the current left-edge day's WEEK START. FLOOR not
      // nearest — by design, forward weeks are reached via Prev/Next, so a free nudge only ever
      // settles BACKWARD to its own Monday. It respects the drag-freeze (re-checks live state in the
      // timeout) and converges in ONE step: a programmatic scroll (zoom / recenter, Feature 1) has
      // already landed on a week start, so target ≈ scrollLeft and the > 0.5px guard makes it a
      // no-op there — no feedback loop where the snap re-triggers itself.
      if (snapToWeekStart) {
        clearTimeout(snapTimer.current)
        snapTimer.current = window.setTimeout(() => {
          const node = scrollRef.current
          if (!node || useStore.getState().draggingAllocationId !== null) return // respect the drag-freeze
          // Pure floor-to-week-start (with the ≤0.5px convergence guard) lives in weekSnap.ts so it's
          // unit-testable without a measured DOM. null = already aligned → no write, no re-arm loop.
          const target = weekStartSnapTarget(geom, days, node.scrollLeft, calendarWeekStartsOn)
          if (target !== null) node.scrollLeft = target
        }, WEEK_SNAP_IDLE_MS)
      }
    })
  }
  // Cancel the in-flight scroll rAF AND the pending week-snap debounce on unmount.
  useEffect(() => () => {
    if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current)
    clearTimeout(snapTimer.current)
  }, [])
  // When a drag ENDS, catch the window up to any scrolling done while it was frozen.
  useEffect(() => {
    if (!dragging && scrollRef.current) {
      setScrollTop(scrollRef.current.scrollTop)
      setLeftEdgeIdx(geom.indexAt(scrollRef.current.scrollLeft))
    }
  }, [dragging, geom])

  const renderGroupHeader = (group: GroupModel, rowIndex: number, key: string) => (
    <div
      key={key}
      role="row"
      aria-rowindex={rowIndex}
      data-testid="discipline-group"
      className="flex border-y border-line-soft bg-surface"
      style={{ height: LAYOUT.groupHeaderHeight }}
    >
      <div role="rowheader" aria-colindex={1} className="sticky left-0 z-10 shrink-0" style={{ width: LAYOUT.leftColWidth }}>
        <button
          type="button"
          onClick={() => toggleGroup(group.key)}
          aria-expanded={!ui.collapsedGroups.includes(group.key)}
          className="flex h-full w-full items-center gap-2 bg-surface px-3 text-xs font-semibold uppercase tracking-wide hover:bg-canvas"
        >
          <Icon
            name={ui.collapsedGroups.includes(group.key) ? 'chevron-right' : 'chevron-down'}
            size={14}
            className="text-faint"
          />
          <span
            className="inline-block h-2.5 w-2.5 rounded-full ring-1 ring-inset ring-black/10"
            style={{ backgroundColor: group.color ?? 'var(--color-faint)' }}
          />
          <span className="truncate text-ink">{group.title}</span>
        </button>
      </div>
      <div role="gridcell" aria-colindex={2} className="flex shrink-0 items-center px-3 text-xs text-faint" style={{ width: totalWidth }}>
        {ui.collapsedGroups.includes(group.key)
          ? m.scheduler_group_hidden({ count: group.rows.length })
          : group.external
            ? '' /* external parties have no capacity — an avg utilisation here would misleadingly read 0% */
            : utilizationPrefs.showDiscipline
              ? m.scheduler_group_avg_utilisation({
                  percent: group.rows.length ? Math.round((group.rows.reduce((sum, r) => sum + r.utilization, 0) / group.rows.length) * 100) : 0,
                })
              : ''}
      </div>
    </div>
  )

  const renderRow = (group: GroupModel, row: RowModel, rowIndex: number, key: string) => {
    const { resource, rowHeight, bars, dayStates, timeOff, utilization: util, overSoon, dimmed } = row
    return (
      /* bg-surface on the whole row (not just the sticky header) so the row divider
         sits on ONE background — without it the border crosses the surface left column
         and the darker timeline, reading as a two-tone line. */
      <div
        key={key}
        role="row"
        aria-rowindex={rowIndex}
        data-testid="scheduler-row"
        data-dimmed={dimmed || undefined}
        title={dimmed ? m.scheduler_row_dimmed_title() : undefined}
        className={`flex border-b border-line-soft bg-surface ${dimmed ? 'opacity-45' : ''}`}
        style={{ height: rowHeight }}
      >
        <div
          role="rowheader"
          aria-colindex={1}
          className={`sticky left-0 z-10 flex shrink-0 items-start gap-2 border-r border-line bg-surface ps-3 ${
            resource.kind === 'placeholder' ? 'hatch-lines' : ''
          }`}
          style={{ width: LAYOUT.leftColWidth }}
        >
          {/* Text equivalent of the colour-only capacity cues (over-marker red background, time-off
              tint). The per-day over-marker is otherwise colour/shape-only and unannounced (WCAG
              1.1.1/1.3.1), so count the over-capacity days (allocated > available) and surface them
              here — the non-colour pair to the red background. */}
          <span className="sr-only">
            {overSoon ? m.scheduler_sr_overbooked_two_weeks() : ''}
            {(() => {
              const overDays = dayStates.filter((d) => d.over).length
              return overDays
                ? overDays > 1
                  ? m.scheduler_sr_over_capacity_other({ count: overDays })
                  : m.scheduler_sr_over_capacity_one({ count: overDays })
                : ''
            })()}
            {timeOff.length
              ? timeOff.length > 1
                ? m.scheduler_sr_timeoff_other({ count: timeOff.length })
                : m.scheduler_sr_timeoff_one({ count: timeOff.length })
              : ''}
            {/* The visible utilisation % (right column) conveys its meaning only via a `title` on a
                non-interactive span, which AT may not expose — fold it into this summary so a SR hears
                it (WCAG 1.3.1). This is the per-PERSON, visible-window utilisation signal — kept
                separate from the over-marker count above and the `overSoon` flag; mirrors exactly the
                visible figure's gate (showPersonal + capacity-tracked). */}
            {utilizationPrefs.showPersonal && isCapacityTracked(resource)
              ? m.scheduler_sr_utilisation({ percent: Math.round(util * 100), span: visibleWeeksLabel })
              : ''}
            {bars.length === 1 ? m.scheduler_sr_allocations_one({ count: bars.length }) : m.scheduler_sr_allocations_other({ count: bars.length })}
          </span>
          {/* Avatar + identity, vertically centred within the FIRST lane band
              (rowPadding + barHeight + rowPadding = a single-lane row height) and pinned to
              the top of the row. So a one-lane row keeps its balanced top/bottom padding
              (the band IS the whole row), while a taller multi-allocation row keeps the name
              aligned with the first bar instead of drifting to the row's centre as it grows.
              The "+/%" box stays self-stretch (full height); only this block is banded. */}
          <div
            className="flex min-w-0 flex-1 items-center gap-2"
            style={{ height: LAYOUT.rowPadding * 2 + LAYOUT.barHeight }}
          >
            {/* Avatar fill follows the DISCIPLINE colour (group.color), so everyone in a
                discipline reads as one colour; fall back to the resource's own colour for
                the ungrouped "No discipline" bucket. */}
            <Avatar
              name={resource.name ?? resource.role}
              color={group.color ?? resource.color}
              placeholder={resource.kind === 'placeholder'}
            />
            {/* ms-1.5: a little extra breathing room between the avatar and the text. */}
            <div className="ms-1.5 min-w-0 flex-1">
              <span className="flex items-center gap-1 truncate text-sm font-medium">
                {/* A placeholder ("slot") reads as the literal word "Placeholder" — an as-yet-unfilled
                    slot — with its role/discipline shown as secondary text below. */}
                {resourceDisplayName(resource)}
              </span>
              <span className="block truncate text-xs text-muted">{resource.role}</span>
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
            {canEdit && (
            <button
              type="button"
              onClick={() => {
                const d = visibleStartDate()
                setModal({ kind: 'create', resourceId: resource.id, startDate: d, endDate: d })
              }}
              aria-label={m.scheduler_add_allocation_for({ name: resourceDisplayName(resource) })}
              title={m.scheduler_add_allocation()}
              // Hover tints brand-soft (the AA-validated Add/Save pastel pair), not the old
              // hover:bg-canvas — canvas is the page background, so on a bg-surface row that hover
              // was near-invisible. "+" is the create affordance, so it reads as the brand action.
              className="flex w-11 flex-1 items-center justify-center text-muted transition hover:bg-brand-soft hover:text-brand-soft-ink"
            >
              <Icon name="plus" size={15} />
            </button>
            )}
            {utilizationPrefs.showPersonal && isCapacityTracked(resource) && (
            <span
              data-testid="utilization"
              title={
                // The % itself is over the VISIBLE range; the overSoon red flag is the separate
                // fixed-window "over soon" warning (next UTILIZATION_WINDOW_DAYS days).
                overSoon
                  ? m.scheduler_util_title_oversoon({ days: UTILIZATION_WINDOW_DAYS, span: visibleWeeksLabel })
                  : m.scheduler_util_title({ span: visibleWeeksLabel })
              }
              className={`flex w-11 flex-1 items-center justify-center border-t border-line text-2xs ${
                overSoon ? 'font-semibold text-danger' : 'text-faint'
              }`}
            >
              {Math.round(util * 100)}%
            </span>
            )}
          </div>
        </div>

        <ResourceLane
          resourceId={resource.id}
          // Accessible name for the lane's role="gridcell" (col 2): the timeline cell was
          // previously unnamed. "<name> timeline" names it without duplicating the rowheader's
          // sr-only capacity summary, so the cell reads honestly in the column structure (WCAG 1.3.1).
          ariaLabel={m.scheduler_lane_aria({ name: resourceDisplayName(resource) })}
          days={days}
          dayStates={dayStates}
          timeOff={timeOff}
          todayX={todayX}
          dayWidth={dayWidth}
          geom={geom}
          origin={ui.originDate}
          rowHeight={rowHeight}
          bars={bars}
          placeholder={resource.kind === 'placeholder'}
          weekStartsOn={calendarWeekStartsOn}
          // Viewer (P1.12): pass NO edit/draw callbacks — the lane then bails its draw gesture and
          // drops the hover "+" hint (display-only). Editable (null/owner/admin/editor, incl.
          // OFF/local) gets the stable memoised callbacks, byte-identical to today.
          onEdit={canEdit ? handleEdit : undefined}
          onDraw={canEdit ? handleDraw : undefined}
        />
      </div>
    )
  }

  return (
    // h-full passthrough wrapper: holds the scrolling role="grid" plus its sibling live region.
    // The grid must own ONLY row/rowgroup children (WCAG aria-required-children), so the polite
    // status region lives HERE, a sibling of the grid — not inside it. It's sr-only (position:
    // absolute, zero layout), so this wrapper adds no visual change and the grid's h-full still
    // resolves against the same definite height it did before.
    <div className="h-full">
      <div
        ref={scrollRef}
        /* overscroll-x-contain: hitting the timeline's left edge must NOT chain into the
           page — on macOS that overscroll is the browser's back-swipe, which nukes the app. */
        className="relative flex h-full flex-col overflow-auto overscroll-x-contain"
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
        aria-rowcount={items.length + 1}
        onScroll={onScroll}
        // Publish the measured sticky-header height so each AllocationBar's scroll-margin-top reserves
        // the REAL chrome on focus (WCAG 2.4.11), tracking the two-tier header's actual rendered height
        // (zoom/font-size dependent) instead of the LAYOUT.headerHeight floor. Cast: a CSS custom
        // property isn't in React's CSSProperties type.
        style={{ ['--sched-sticky-top' as string]: `${stickyHeaderHeight}px` }}
      >
        {/* min-w-max: this is a flex item of the flex-col scroll container, so the
            default align-items:stretch would clamp its width to the container's cross
            size (the viewport), leaving the wide DateHeader to overflow and only the
            first ~2 weeks painted. Sizing to content makes header + rows span the full
            timeline and scroll together. Same reason on the rowgroup below. */}
        <div ref={headerRef} role="row" aria-rowindex={1} className="sticky top-0 z-20 flex min-w-max shrink-0 border-b border-line-soft bg-surface" style={{ minHeight: LAYOUT.headerHeight }}>
          <div
            role="columnheader"
            aria-colindex={1}
            className="sticky left-0 z-30 flex shrink-0 flex-col justify-center border-r border-line bg-surface px-3"
            style={{ width: LAYOUT.leftColWidth }}
          >
            {utilizationPrefs.showTotal && (
              <>
                <span
                  className="text-2xs font-medium uppercase tracking-wide text-faint"
                  title={m.scheduler_total_util_title({ span: visibleWeeksLabel })}
                >
                  {/* The headline % follows the VISIBLE range, so the label tracks the selected zoom
                      span (1/2/4/6/8 weeks) rather than naming a fixed "next 2w". */}
                  {m.scheduler_total_util_label({ count: ui.zoom })}
                </span>
                <span data-testid="overall-utilization" className="text-sm font-semibold">
                  {overallUtil}%
                </span>
              </>
            )}
          </div>
          <DateHeader days={days} dayWidth={dayWidth} geom={geom} weekStartsOn={calendarWeekStartsOn} today={today} />
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
                  icon="sliders"
                  description={m.scheduler_empty_filtered_desc()}
                  action={{ label: m.scheduler_empty_clear_filters(), onClick: () => clearFilters() }}
                >
                  {m.scheduler_empty_filtered_title()}
                </EmptyState>
              ) : (
                <EmptyState
                  icon="people"
                  description={m.scheduler_empty_desc()}
                  action={{ label: m.scheduler_empty_go_resources(), onClick: () => void navigate('/resources') }}
                >
                  {m.scheduler_empty_title()}
                </EmptyState>
              )}
            </div>
          </div>
        )}

        {items.length > 0 && (
          <div role="rowgroup" className="min-w-max shrink-0">
            {/* Spacer reserving the scroll height of the rows above the rendered slice. */}
            {topPad > 0 && <div aria-hidden style={{ height: topPad }} />}
            {visible.map((item, i) => {
              // aria-rowindex is 1-based and global: header is 1, so items start at 2.
              const rowIndex = first + i + 2
              return item.kind === 'group'
                ? renderGroupHeader(item.group, rowIndex, `g-${item.group.key}`)
                : renderRow(item.group, item.row, rowIndex, `r-${item.row.resource.id}`)
            })}
            {bottomPad > 0 && <div aria-hidden style={{ height: bottomPad }} />}
          </div>
        )}

        {modal &&
          (modal.kind === 'edit' ? (
            <AllocationModal allocationId={modal.allocationId} onClose={() => setModal(null)} />
          ) : modal.kind === 'timeoff' ? (
            <TimeOffForm
              defaults={{ resourceId: modal.resourceId, startDate: modal.startDate, endDate: modal.endDate }}
              onClose={() => setModal(null)}
            />
          ) : (
            <AllocationModal
              create={{ resourceId: modal.resourceId, startDate: modal.startDate, endDate: modal.endDate }}
              onClose={() => setModal(null)}
            />
          ))}
      </div>

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
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="scheduler-live-region">
        {srAnnouncement && <span key={srAnnouncement.seq}>{srAnnouncement.text}</span>}
      </div>
    </div>
  )
}
