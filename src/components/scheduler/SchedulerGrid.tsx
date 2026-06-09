import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { hasActiveFilters, useStore } from '../../store/useStore'
import { useScopedData } from '../../store/useScopedData'
import { visibleRange } from '../../store/selectors'
import { addDaysISO, eachDayISO, todayISO, xForDate } from '@floaty/shared/lib/dateMath'
import { FALLBACK_TIMELINE_WIDTH, UTILIZATION_WINDOW_DAYS, resolveDayWidth } from '../../lib/schedulerConfig'
import { Avatar, TemporaryTag } from '../common/ui'
import { Icon } from '../common/Icon'
import { LAYOUT } from './layout'
import { DateHeader } from './DateHeader'
import { ResourceLane } from './ResourceLane'
import { AllocationModal } from './AllocationModal'
import { TimeOffForm } from '../timeoff/TimeOffForm'
import { buildSchedulerModel } from './schedulerModel'
import { buildLayout, windowFromLayout } from './virtualWindow'
import type { GroupModel, RowModel } from './schedulerModel'
import type { ID, ISODate } from '@floaty/shared/types/entities'

type ModalState =
  | { kind: 'edit'; allocationId: ID }
  | { kind: 'create'; resourceId: ID; startDate: ISODate; endDate: ISODate }
  | { kind: 'timeoff'; resourceId: ID; startDate: ISODate; endDate: ISODate }

export function SchedulerGrid() {
  const data = useScopedData()
  const ui = useStore((s) => s.ui)
  // Utilisation display toggles (Settings → Utilisation). Each gates one of the three
  // utilisation figures: total (header), discipline (group header), personal (per row).
  const utilizationPrefs = useStore((s) => s.utilizationPrefs)
  const toggleGroup = useStore((s) => s.toggleGroup)
  const [modal, setModal] = useState<ModalState | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const didScroll = useRef(false)
  const [timelineWidth, setTimelineWidth] = useState(0)
  const [timelineHeight, setTimelineHeight] = useState(0) // viewport height for row virtualization
  const [scrollTop, setScrollTop] = useState(0)
  const scrollRaf = useRef(0)

  // Measure the scroll container so the day-column width can fit ui.zoom weeks (and
  // the height drives row virtualization).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => {
      setTimelineWidth(el.clientWidth)
      setTimelineHeight(el.clientHeight)
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

  const dayWidth = resolveDayWidth((timelineWidth || FALLBACK_TIMELINE_WIDTH) - LAYOUT.leftColWidth, ui.zoom)

  const { start, end } = visibleRange(ui)
  const days = useMemo(() => eachDayISO(start, end), [start, end])
  const totalWidth = days.length * dayWidth

  const today = todayISO()
  // Utilisation is a near-term radar: a fixed forward window from today, independent
  // of zoom and pan, so the per-resource overbooked flag actually fires.
  const utilStart = today
  const utilEnd = addDaysISO(today, UTILIZATION_WINDOW_DAYS - 1)

  const model = useMemo(
    () => buildSchedulerModel(data, ui.originDate, dayWidth, days, utilStart, utilEnd, ui.filters),
    [data, ui.originDate, dayWidth, days, utilStart, utilEnd, ui.filters],
  )

  const todayX = today >= start && today <= end ? xForDate(today, ui.originDate, dayWidth) : null

  // Where the grid scrolls on a focus request (Today / jump-to-date). Held in a ref
  // so zoom/resize re-renders don't re-fire the recenter effect.
  const focusX = xForDate(ui.focusDate, ui.originDate, dayWidth)
  const focusXRef = useRef(focusX)
  useEffect(() => {
    focusXRef.current = focusX
  })

  // Bring the focus date (today by default) into view on first render — but only
  // once the container has been MEASURED (timelineWidth > 0), so the scroll uses the
  // real dayWidth, not the fallback. Runs once (didScroll guard); re-fires harmlessly
  // until the real width arrives in jsdom/SSR where it never does.
  useEffect(() => {
    if (didScroll.current || !scrollRef.current || timelineWidth === 0) return
    scrollRef.current.scrollLeft = Math.max(0, focusXRef.current - LAYOUT.recenterLeftPad)
    didScroll.current = true
  }, [timelineWidth])

  // Re-centre when the user clicks Today / picks a date (which bumps recenterToken).
  const recenterToken = ui.recenterToken
  useEffect(() => {
    if (recenterToken === 0 || !scrollRef.current) return
    scrollRef.current.scrollLeft = Math.max(0, focusXRef.current - LAYOUT.recenterLeftPad)
  }, [recenterToken])

  const filtersActive = hasActiveFilters(ui.filters)

  // Stable callbacks so the memoised ResourceLane can skip re-rendering on
  // grid-level UI changes (e.g. opening a modal). setModal is referentially stable.
  const handleEdit = useCallback((allocationId: ID) => setModal({ kind: 'edit', allocationId }), [])
  const handleDraw = useCallback(
    (resourceId: ID, startDate: ISODate, endDate: ISODate) =>
      setModal({ kind: ui.drawMode === 'timeoff' ? 'timeoff' : 'create', resourceId, startDate, endDate }),
    [ui.drawMode],
  )

  // The date currently at the left edge of the viewport — what the "+" quick-create
  // should default to, so it lands where the user is looking (not always today).
  const visibleStartDate = (): ISODate => {
    const el = scrollRef.current
    const offsetDays = el ? Math.max(0, Math.floor(el.scrollLeft / dayWidth)) : 0
    return addDaysISO(ui.originDate, offsetDays)
  }

  // Derived from the model only — memoise so opening a modal / measuring the
  // container (frequent re-renders) doesn't re-flatMap + re-reduce every row.
  const overallUtil = useMemo(() => {
    const rows = model.flatMap((g) => g.rows)
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
      out.push({ kind: 'group', group })
      if (!ui.collapsedGroups.includes(group.key)) for (const row of group.rows) out.push({ kind: 'row', group, row })
    }
    return out
  }, [model, ui.collapsedGroups])

  // Heights + their prefix-sum depend only on the item set (model/collapse), NOT on
  // scroll — memoise so a scroll frame only runs the cheap edge-scan in windowFromLayout.
  const heights = useMemo(
    () => items.map((it) => (it.kind === 'group' ? LAYOUT.groupHeaderHeight : it.row.rowHeight)),
    [items],
  )
  const layout = useMemo(() => buildLayout(heights), [heights])
  // Pin the dragged row while a gesture is live: a mid-drag vertical scroll must NOT
  // re-window, or it could unmount the dragged AllocationBar and tear down its document
  // pointer listeners (orphaning the drag, so the drop never commits). We FREEZE the scroll
  // input instead — onScroll skips setScrollTop while dragging — so the window stays put
  // until the drag ends, then a one-shot effect catches it up. `draggingAllocationId` is
  // transient store state.
  const dragging = useStore((s) => s.draggingAllocationId !== null)
  const { first, last, topPad, bottomPad } = windowFromLayout(layout, heights, scrollTop, timelineHeight)
  const visible = items.slice(first, last + 1)

  // rAF-coalesced vertical scroll → recompute the window. Horizontal scroll lands here
  // too but setScrollTop with an unchanged value is a no-op (React bails the re-render).
  const onScroll = () => {
    if (scrollRaf.current) return
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = 0
      // Don't re-window mid-drag — it could unmount the dragged row and orphan the gesture.
      // Read draggingAllocationId LIVE (getState) to avoid a stale closure.
      if (useStore.getState().draggingAllocationId !== null) return
      if (scrollRef.current) setScrollTop(scrollRef.current.scrollTop)
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
          className={`sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-line bg-surface ps-3 ${
            resource.kind === 'placeholder' ? 'hatch-lines' : ''
          }`}
          style={{ width: LAYOUT.leftColWidth }}
        >
          {/* Text equivalent of the colour-only capacity cues (over-marker, time-off tint). The
              per-day over-marker is otherwise colour/shape-only and unannounced (WCAG 1.1.1/1.3.1),
              so count the zero-capacity days that carry scheduled work and surface them here. */}
          <span className="sr-only">
            {overSoon ? 'Overbooked in the next two weeks. ' : ''}
            {(() => {
              const overDays = dayStates.filter((d) => d.over).length
              return overDays ? `Scheduled on ${overDays} zero-capacity day${overDays > 1 ? 's' : ''}. ` : ''
            })()}
            {timeOff.length ? `${timeOff.length} time-off period${timeOff.length > 1 ? 's' : ''}. ` : ''}
            {bars.length} allocation{bars.length === 1 ? '' : 's'}.
          </span>
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
              {/* Placeholders ("slots") read as quoted names in the schedule view — the
                  quotes do the work the old "slot" pill did, without the extra chrome. */}
              {resource.kind === 'placeholder'
                ? `“${resource.name ?? resource.role}”`
                : (resource.name ?? resource.role)}
              <TemporaryTag resource={resource} />
            </span>
            <span className="block truncate text-xs text-muted">{resource.role}</span>
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
              aria-label={`Add allocation for ${resource.name ?? resource.role}`}
              title="Add allocation"
              className="flex w-11 flex-1 items-center justify-center text-muted transition hover:bg-canvas hover:text-ink"
            >
              <Icon name="plus" size={15} />
            </button>
            {utilizationPrefs.showPersonal && (
            <span
              data-testid="utilization"
              title={
                overSoon
                  ? `Overbooked within the next ${UTILIZATION_WINDOW_DAYS} days`
                  : `Utilisation over the next ${UTILIZATION_WINDOW_DAYS} days`
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
          origin={ui.originDate}
          totalWidth={totalWidth}
          rowHeight={rowHeight}
          bars={bars}
          placeholder={resource.kind === 'placeholder'}
          onEdit={handleEdit}
          onDraw={handleDraw}
        />
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      className="relative flex h-full flex-col overflow-auto"
      data-testid="scheduler-grid"
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
                title={`Average utilisation over the next ${UTILIZATION_WINDOW_DAYS} days`}
              >
                Utilisation · next 2w
              </span>
              <span data-testid="overall-utilization" className="text-sm font-semibold">
                {overallUtil}%
              </span>
            </>
          )}
        </div>
        <DateHeader days={days} dayWidth={dayWidth} />
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
