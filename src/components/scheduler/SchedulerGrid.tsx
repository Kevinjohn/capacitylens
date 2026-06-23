import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { hasActiveFilters, useStore } from '../../store/useStore'
import { useScopedData } from '../../store/useScopedData'
import { disciplinesEnabledFor, visibleRange } from '../../store/selectors'
import { addDaysISO, eachDayISO, todayISO } from '@floaty/shared/lib/dateMath'
import { FALLBACK_TIMELINE_WIDTH, UTILIZATION_WINDOW_DAYS, WEEKEND_COLUMN_REM, resolveDayWidth } from '../../lib/schedulerConfig'
import { Avatar } from '../common/ui'
import { resourceDisplayName } from '../../lib/metadata'
import { Icon } from '../common/Icon'
import { LAYOUT } from './layout'
import { DateHeader } from './DateHeader'
import { ResourceLane } from './ResourceLane'
import { AllocationModal } from './AllocationModal'
import { TimeOffForm } from '../timeoff/TimeOffForm'
import { buildColumnGeometry } from './columnGeometry'
import { buildSchedulerModel } from './schedulerModel'
import { buildLayout, windowFromLayout } from './virtualWindow'
import type { GroupModel, RowModel } from './schedulerModel'
import { isCapacityTracked, isExternalResource } from '@floaty/shared/types/entities'
import type { ID, ISODate } from '@floaty/shared/types/entities'

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
  const data = useScopedData()
  const ui = useStore((s) => s.ui)
  // Utilisation display toggles (Settings → Utilisation). Each gates one of the three
  // utilisation figures: total (header), discipline (group header), personal (per row).
  const utilizationPrefs = useStore((s) => s.utilizationPrefs)
  // Device-global display pref (default on): narrow the weekend columns. Drives the geometry below.
  const minimiseWeekends = useStore((s) => s.minimiseWeekends)
  // Device-global display pref (default OFF): when off, placeholder ("slot") rows are hidden from
  // the schedule (and dropped from utilisation) by buildSchedulerModel's resourceVisible filter.
  const placeholdersEnabled = useStore((s) => s.placeholdersEnabled)
  // Device-global display pref (default OFF): when off, external / 3rd-party rows are hidden from the
  // schedule (and their now-empty band header is dropped) by buildSchedulerModel's resourceVisible filter.
  const externalEnabled = useStore((s) => s.externalEnabled)
  // Account-level: when disciplines are off, the schedule renders flat (no discipline
  // bands) and the discipline filter is ignored (see buildSchedulerModel + items below).
  const disciplinesEnabled = useStore((s) => disciplinesEnabledFor(s.data, s.activeAccountId))
  const toggleGroup = useStore((s) => s.toggleGroup)
  const [modal, setModal] = useState<ModalState | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
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

  // Measure the scroll container so the day-column width can fit ui.zoom weeks (and
  // the height drives row virtualization).
  useEffect(() => {
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
  const visibleWeeksLabel = `${ui.zoom} week${ui.zoom === 1 ? '' : 's'}`

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
      ),
    [data, geom, days, visStart, visEnd, overStart, overEnd, ui.filters, disciplinesEnabled, placeholdersEnabled, externalEnabled],
  )

  const todayX = today >= start && today <= end ? geom.xForDateInGeom(today) : null

  // Where the grid scrolls on a focus request (Today / jump-to-date). Held in a ref
  // so zoom/resize re-renders don't re-fire the recenter effect.
  const focusX = geom.xForDateInGeom(ui.focusDate)
  const focusXRef = useRef(focusX)
  useEffect(() => {
    focusXRef.current = focusX
  })

  // Keep the left-edge DATE anchored when the COLUMN WIDTHS change (zoom click, container
  // resize, or the minimise-weekends toggle): scrollLeft is pixels, so the same offset would
  // otherwise re-point at a different date — with the past buffer behind the focus date that
  // read as a multi-week jump on every zoom flip. We read the date at the left edge under the
  // PREVIOUS geometry, then re-locate it under the new one (variable widths rule out a flat
  // ratio). Skipped until the initial scroll has run (didScroll); that effect (below, so it runs
  // AFTER this one skips on the first-measure commit) owns the first real-width placement.
  //
  // A PAN (Back/Forward week → originDate change → a new `days` array) must NOT re-anchor:
  // preserving scrollLeft while the window shifts is exactly what advances the view by a week.
  // The `days === prevDays` test distinguishes a width change (same day set, new widths) from a
  // pan (new day set) — `days` is referentially stable across a pure zoom/resize.
  const prevGeomRef = useRef(geom)
  const prevDaysRef = useRef(days)
  useEffect(() => {
    const prevGeom = prevGeomRef.current
    const prevDays = prevDaysRef.current
    prevGeomRef.current = geom
    prevDaysRef.current = days
    const el = scrollRef.current
    if (!el || !didScroll.current || days !== prevDays || prevGeom === geom || prevGeom.totalWidth <= 0) return
    const leftDate = days[prevGeom.indexAt(el.scrollLeft)] ?? days[0]
    el.scrollLeft = geom.xForDateInGeom(leftDate)
  }, [geom, days])

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
  useEffect(() => {
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
    })
  }
  useEffect(() => () => { if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current) }, [])
  // When a drag ENDS, catch the window up to any scrolling done while it was frozen.
  useEffect(() => {
    if (!dragging && scrollRef.current) setScrollTop(scrollRef.current.scrollTop)
  }, [dragging])

  const renderGroupHeader = (group: GroupModel, rowIndex: number, key: string) => (
    <div
      key={key}
      role="row"
      aria-rowindex={rowIndex}
      data-testid="discipline-group"
      className="flex border-y border-line-soft bg-surface"
      style={{ height: LAYOUT.groupHeaderHeight }}
    >
      <div role="rowheader" className="sticky left-0 z-10 shrink-0" style={{ width: LAYOUT.leftColWidth }}>
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
      <div role="gridcell" className="flex shrink-0 items-center px-3 text-xs text-faint" style={{ width: totalWidth }}>
        {ui.collapsedGroups.includes(group.key)
          ? `${group.rows.length} hidden`
          : group.external
            ? '' /* external parties have no capacity — an avg utilisation here would misleadingly read 0% */
            : utilizationPrefs.showDiscipline
              ? `${group.rows.length ? Math.round((group.rows.reduce((sum, r) => sum + r.utilization, 0) / group.rows.length) * 100) : 0}% avg utilisation`
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
        title={dimmed ? 'No work on this project — available to staff (drag work onto this row)' : undefined}
        className={`flex border-b border-line-soft bg-surface ${dimmed ? 'opacity-45' : ''}`}
        style={{ height: rowHeight }}
      >
        <div
          role="rowheader"
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
            {overSoon ? 'Overbooked in the next two weeks. ' : ''}
            {(() => {
              const overDays = dayStates.filter((d) => d.over).length
              return overDays ? `Over capacity on ${overDays} day${overDays > 1 ? 's' : ''}. ` : ''
            })()}
            {timeOff.length ? `${timeOff.length} time-off period${timeOff.length > 1 ? 's' : ''}. ` : ''}
            {bars.length} allocation{bars.length === 1 ? '' : 's'}.
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
            <button
              type="button"
              onClick={() => {
                const d = visibleStartDate()
                setModal({ kind: 'create', resourceId: resource.id, startDate: d, endDate: d })
              }}
              aria-label={`Add allocation for ${resourceDisplayName(resource)}`}
              title="Add allocation"
              className="flex w-11 flex-1 items-center justify-center text-muted transition hover:bg-canvas hover:text-ink"
            >
              <Icon name="plus" size={15} />
            </button>
            {utilizationPrefs.showPersonal && isCapacityTracked(resource) && (
            <span
              data-testid="utilization"
              title={
                // The % itself is over the VISIBLE range; the overSoon red flag is the separate
                // fixed-window "over soon" warning (next UTILIZATION_WINDOW_DAYS days).
                overSoon
                  ? `Overbooked within the next ${UTILIZATION_WINDOW_DAYS} days — utilisation shown over the visible ${visibleWeeksLabel}`
                  : `Utilisation over the visible ${visibleWeeksLabel}`
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
          onEdit={handleEdit}
          onDraw={handleDraw}
        />
      </div>
    )
  }

  return (
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
      aria-label="Resource schedule"
      aria-rowcount={items.length + 1}
      onScroll={onScroll}
    >
      {/* min-w-max: this is a flex item of the flex-col scroll container, so the
          default align-items:stretch would clamp its width to the container's cross
          size (the viewport), leaving the wide DateHeader to overflow and only the
          first ~2 weeks painted. Sizing to content makes header + rows span the full
          timeline and scroll together. Same reason on the rowgroup below. */}
      <div role="row" aria-rowindex={1} className="sticky top-0 z-20 flex min-w-max shrink-0 border-b border-line-soft bg-surface" style={{ minHeight: LAYOUT.headerHeight }}>
        <div
          role="columnheader"
          className="sticky left-0 z-30 flex shrink-0 flex-col justify-center border-r border-line bg-surface px-3"
          style={{ width: LAYOUT.leftColWidth }}
        >
          {utilizationPrefs.showTotal && (
            <>
              <span
                className="text-2xs font-medium uppercase tracking-wide text-faint"
                title={`Average utilisation over the visible ${visibleWeeksLabel}`}
              >
                {/* The headline % follows the VISIBLE range, so the label tracks the zoom toggle
                    (1w/2w/4w/8w) rather than naming a fixed "next 2w". */}
                Utilisation · {ui.zoom}w
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
        <div role="row" className="flex min-h-0 flex-1">
          <div
            role="rowheader"
            data-testid="scheduler-empty"
            className="sticky left-0 z-10 flex shrink-0 flex-col gap-2 border-r border-line bg-surface px-3 py-5 text-sm text-muted"
            style={{ width: LAYOUT.leftColWidth }}
          >
            {filtersActive ? (
              <span>No resources match the current filters.</span>
            ) : (
              <>
                <span className="font-medium text-ink">No resources yet</span>
                <span>
                  Add people on the <span className="font-medium text-ink">Resources</span> page.
                </span>
                <span>Then click or drag on a row to schedule work.</span>
              </>
            )}
          </div>
          <div className="flex-1 bg-canvas/30" aria-hidden />
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
  )
}
