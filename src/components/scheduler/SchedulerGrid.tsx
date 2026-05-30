import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { hasActiveFilters, useStore } from '../../store/useStore'
import { useScopedData } from '../../store/useScopedData'
import { visibleRange } from '../../store/selectors'
import { addDaysISO, eachDayISO, todayISO, xForDate } from '../../lib/dateMath'
import { FALLBACK_TIMELINE_WIDTH, UTILIZATION_WINDOW_DAYS, resolveDayWidth } from '../../lib/schedulerConfig'
import { Avatar, TemporaryTag } from '../common/ui'
import { Icon } from '../common/Icon'
import { LAYOUT } from './layout'
import { DateHeader } from './DateHeader'
import { ResourceLane } from './ResourceLane'
import { AllocationModal } from './AllocationModal'
import { TimeOffForm } from '../timeoff/TimeOffForm'
import { buildSchedulerModel } from './schedulerModel'
import type { ID, ISODate } from '../../types/entities'

type ModalState =
  | { kind: 'edit'; allocationId: ID }
  | { kind: 'create'; resourceId: ID; startDate: ISODate; endDate: ISODate }
  | { kind: 'timeoff'; resourceId: ID; startDate: ISODate; endDate: ISODate }

export function SchedulerGrid() {
  const data = useScopedData()
  const ui = useStore((s) => s.ui)
  const toggleGroup = useStore((s) => s.toggleGroup)
  const [modal, setModal] = useState<ModalState | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const didScroll = useRef(false)
  const [timelineWidth, setTimelineWidth] = useState(0)

  // Measure the scroll container so the day-column width can fit ui.zoom weeks.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setTimelineWidth(el.clientWidth)
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

  const allRows = model.flatMap((g) => g.rows)
  const overallUtil = allRows.length
    ? Math.round((allRows.reduce((sum, r) => sum + r.utilization, 0) / allRows.length) * 100)
    : 0

  return (
    <div
      ref={scrollRef}
      className="relative h-full overflow-auto"
      data-testid="scheduler-grid"
      role="grid"
      aria-label="Resource schedule"
    >
      <div role="row" className="sticky top-0 z-20 flex border-b border-line bg-surface" style={{ height: LAYOUT.headerHeight }}>
        <div
          role="columnheader"
          className="sticky left-0 z-30 flex shrink-0 flex-col justify-center border-r border-line bg-surface px-3"
          style={{ width: LAYOUT.leftColWidth }}
        >
          <span
            className="text-2xs font-medium uppercase tracking-wide text-faint"
            title={`Average load over the next ${UTILIZATION_WINDOW_DAYS} days`}
          >
            Load · next 2w
          </span>
          <span data-testid="overall-utilization" className="text-sm font-semibold">
            {overallUtil}%
          </span>
        </div>
        <DateHeader days={days} dayWidth={dayWidth} />
      </div>

      {model.length === 0 && (
        <div className="p-8 text-sm text-muted" data-testid="scheduler-empty">
          {filtersActive ? (
            <>No resources match the current filters.</>
          ) : (
            <>
              No resources yet. Add people on the <span className="font-medium text-ink">Resources</span> page, then draw on a
              row to schedule work.
            </>
          )}
        </div>
      )}

      {model.map((group) => (
        <div key={group.key} role="rowgroup">
          <div
            role="row"
            data-testid="discipline-group"
            className="flex border-y border-line bg-surface"
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
                : `${group.rows.length ? Math.round((group.rows.reduce((sum, r) => sum + r.utilization, 0) / group.rows.length) * 100) : 0}% avg load`}
            </div>
          </div>

          {!ui.collapsedGroups.includes(group.key) &&
            group.rows.map(({ resource, rowHeight, bars, dayStates, timeOff, utilization: util, overSoon }) => (
            /* bg-surface on the whole row (not just the sticky header) so the row divider
               sits on ONE background — without it the border crosses the surface left column
               and the darker timeline, reading as a two-tone line. */
            <div key={resource.id} role="row" data-testid="scheduler-row" className="flex border-b border-line bg-surface" style={{ height: rowHeight }}>
              <div
                role="rowheader"
                className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-line bg-surface px-3"
                style={{ width: LAYOUT.leftColWidth }}
              >
                {/* Text equivalent of the colour-only capacity cues (over-marker, time-off tint). */}
                <span className="sr-only">
                  {overSoon ? 'Overbooked in the next two weeks. ' : ''}
                  {timeOff.length ? `${timeOff.length} time-off period${timeOff.length > 1 ? 's' : ''}. ` : ''}
                  {bars.length} allocation{bars.length === 1 ? '' : 's'}.
                </span>
                {/* Avatar fill follows the DISCIPLINE colour (group.color), so everyone in a
                    discipline reads as one colour; fall back to the resource's own colour for
                    the ungrouped "No discipline" bucket. */}
                <Avatar name={resource.name ?? resource.role} color={group.color ?? resource.color} />
                {/* ms-1.5: a little extra breathing room between the avatar and the text. */}
                <div className="ms-1.5 min-w-0 flex-1">
                  <span className="flex items-center gap-1 truncate text-sm font-medium">
                    {resource.name ?? resource.role}
                    {resource.kind === 'placeholder' && <span className="rounded bg-canvas px-1 text-2xs text-muted">slot</span>}
                    <TemporaryTag resource={resource} />
                  </span>
                  <span className="block truncate text-xs text-muted">{resource.role}</span>
                </div>
                {/* Right column as a structured 2-cell grid: the add button on top, the
                    allocation % beneath it, split by a divider inside one rounded box. */}
                <div className="flex shrink-0 flex-col overflow-hidden rounded-md border border-line text-center leading-none">
                  <button
                    type="button"
                    onClick={() => {
                      const d = visibleStartDate()
                      setModal({ kind: 'create', resourceId: resource.id, startDate: d, endDate: d })
                    }}
                    aria-label={`Add allocation for ${resource.name ?? resource.role}`}
                    title="Add allocation"
                    className="flex h-6 w-11 items-center justify-center text-muted transition hover:bg-canvas hover:text-ink"
                  >
                    <Icon name="plus" size={15} />
                  </button>
                  <span
                    data-testid="utilization"
                    title={
                      overSoon
                        ? `Overbooked within the next ${UTILIZATION_WINDOW_DAYS} days`
                        : `Load over the next ${UTILIZATION_WINDOW_DAYS} days`
                    }
                    className={`flex h-5 w-11 items-center justify-center border-t border-line text-2xs ${
                      overSoon ? 'font-semibold text-danger' : 'text-faint'
                    }`}
                  >
                    {Math.round(util * 100)}%
                  </span>
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
                onEdit={handleEdit}
                onDraw={handleDraw}
              />
            </div>
          ))}
        </div>
      ))}

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
