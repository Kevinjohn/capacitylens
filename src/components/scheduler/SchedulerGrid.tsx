import { useEffect, useMemo, useRef, useState } from 'react'
import { hasActiveFilters, useStore } from '../../store/useStore'
import { visibleRange } from '../../store/selectors'
import { addDaysISO, eachDayISO, todayISO, xForDate } from '../../lib/dateMath'
import { FALLBACK_TIMELINE_WIDTH, UTILIZATION_WINDOW_DAYS, resolveDayWidth } from '../../lib/schedulerConfig'
import { Avatar, TemporaryTag } from '../common/ui'
import { LAYOUT } from './layout'
import { DateHeader } from './DateHeader'
import { ResourceLane } from './ResourceLane'
import { AllocationModal } from './AllocationModal'
import { buildSchedulerModel } from './schedulerModel'
import type { ID, ISODate } from '../../types/entities'

type ModalState =
  | { kind: 'edit'; allocationId: ID }
  | { kind: 'create'; resourceId: ID; startDate: ISODate; endDate: ISODate }

export function SchedulerGrid() {
  const data = useStore((s) => s.data)
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
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
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

  // Keep the latest todayX without re-triggering the re-centre effect on zoom/resize.
  const todayXRef = useRef(todayX)
  useEffect(() => {
    todayXRef.current = todayX
  })

  // Bring "today" into view on first render.
  useEffect(() => {
    if (didScroll.current || !scrollRef.current || todayX === null) return
    scrollRef.current.scrollLeft = Math.max(0, todayX - 120)
    didScroll.current = true
  }, [todayX])

  // Re-centre on "today" when the user clicks Today (which bumps recenterToken).
  const recenterToken = ui.recenterToken
  useEffect(() => {
    if (recenterToken === 0 || !scrollRef.current || todayXRef.current === null) return
    scrollRef.current.scrollLeft = Math.max(0, todayXRef.current - 120)
  }, [recenterToken])

  const filtersActive = hasActiveFilters(ui.filters)

  const allRows = model.flatMap((g) => g.rows)
  const overallUtil = allRows.length
    ? Math.round((allRows.reduce((sum, r) => sum + r.utilization, 0) / allRows.length) * 100)
    : 0

  return (
    <div ref={scrollRef} className="relative h-full overflow-auto" data-testid="scheduler-grid">
      <div className="sticky top-0 z-20 flex border-b border-line bg-surface" style={{ height: LAYOUT.headerHeight }}>
        <div
          className="sticky left-0 z-30 flex shrink-0 flex-col justify-center border-r border-line bg-surface px-3"
          style={{ width: LAYOUT.leftColWidth }}
        >
          <span
            className="text-[10px] font-medium uppercase tracking-wide text-faint"
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
        <div key={group.key}>
          <div
            data-testid="discipline-group"
            className="flex border-y border-line bg-surface"
            style={{ height: LAYOUT.groupHeaderHeight }}
          >
            <button
              type="button"
              onClick={() => toggleGroup(group.key)}
              aria-expanded={!ui.collapsedGroups.includes(group.key)}
              className="sticky left-0 z-10 flex shrink-0 items-center gap-2 bg-surface px-3 text-xs font-semibold uppercase tracking-wide hover:bg-base"
              style={{ width: LAYOUT.leftColWidth }}
            >
              <span className="text-faint" aria-hidden>
                {ui.collapsedGroups.includes(group.key) ? '▸' : '▾'}
              </span>
              <span
                className="inline-block h-2.5 w-2.5 rounded-full ring-1 ring-inset ring-black/10"
                style={{ backgroundColor: group.color ?? 'var(--color-faint)' }}
              />
              <span className="truncate text-ink">{group.title}</span>
            </button>
            <div className="flex shrink-0 items-center px-3 text-xs text-faint" style={{ width: totalWidth }}>
              {ui.collapsedGroups.includes(group.key)
                ? `${group.rows.length} hidden`
                : `${group.rows.length ? Math.round((group.rows.reduce((sum, r) => sum + r.utilization, 0) / group.rows.length) * 100) : 0}% avg load`}
            </div>
          </div>

          {!ui.collapsedGroups.includes(group.key) &&
            group.rows.map(({ resource, rowHeight, bars, dayStates, timeOff, utilization: util, overSoon }) => (
            <div key={resource.id} data-testid="resource-row" className="flex border-b border-line" style={{ height: rowHeight }}>
              <div
                className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-line bg-surface px-3"
                style={{ width: LAYOUT.leftColWidth }}
              >
                <Avatar name={resource.name ?? resource.role} color={resource.color} />
                <div className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 truncate text-sm font-medium">
                    {resource.name ?? resource.role}
                    {resource.kind === 'placeholder' && <span className="rounded bg-base px-1 text-[10px] text-muted">slot</span>}
                    <TemporaryTag resource={resource} />
                  </span>
                  <span className="flex items-center gap-2 truncate text-xs text-muted">
                    <span className="truncate">{resource.role}</span>
                    <span
                      data-testid="utilization"
                      title={
                        overSoon
                          ? `Overbooked within the next ${UTILIZATION_WINDOW_DAYS} days`
                          : `Load over the next ${UTILIZATION_WINDOW_DAYS} days`
                      }
                      className={overSoon ? 'font-semibold text-danger' : 'text-faint'}
                    >
                      {Math.round(util * 100)}%
                    </span>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setModal({ kind: 'create', resourceId: resource.id, startDate: today, endDate: today })}
                  aria-label={`Add allocation for ${resource.name ?? resource.role}`}
                  title="Add allocation"
                  className="shrink-0 rounded p-1 text-lg leading-none text-muted hover:bg-base hover:text-ink"
                >
                  +
                </button>
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
                onEdit={(allocationId) => setModal({ kind: 'edit', allocationId })}
                onDraw={(resourceId, startDate, endDate) => setModal({ kind: 'create', resourceId, startDate, endDate })}
              />
            </div>
          ))}
        </div>
      ))}

      {modal &&
        (modal.kind === 'edit' ? (
          <AllocationModal allocationId={modal.allocationId} onClose={() => setModal(null)} />
        ) : (
          <AllocationModal
            create={{ resourceId: modal.resourceId, startDate: modal.startDate, endDate: modal.endDate }}
            onClose={() => setModal(null)}
          />
        ))}
    </div>
  )
}
