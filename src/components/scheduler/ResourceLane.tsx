import { memo, useEffect, useRef, useState } from 'react'
import { addDaysISO, weekdayOf } from '../../lib/dateMath'
import { DAY_COLUMN_MIN_WIDTH } from '../../lib/schedulerConfig'
import { AllocationBar } from './AllocationBar'
import { LAYOUT } from './layout'
import type { BarLayout, DayState, TimeOffBlock } from './schedulerModel'
import type { ID, ISODate } from '../../types/entities'

/** Min pointer travel to treat a lane gesture as a draw (vs a bare click). */
const DRAW_THRESHOLD_PX = 4

// Memoised so a sibling lane's draw gesture (per-pointermove setDraw) and grid-level
// UI re-renders (e.g. opening a modal) don't re-render every lane + its bars. Its
// props are stable model-derived values; onEdit/onDraw are stabilised in SchedulerGrid.
export const ResourceLane = memo(function ResourceLane({
  resourceId,
  days,
  dayStates,
  timeOff,
  todayX,
  dayWidth,
  origin,
  totalWidth,
  rowHeight,
  bars,
  onEdit,
  onDraw,
}: {
  resourceId: ID
  days: ISODate[]
  dayStates: DayState[]
  timeOff: TimeOffBlock[]
  todayX: number | null
  dayWidth: number
  origin: ISODate
  totalWidth: number
  rowHeight: number
  bars: BarLayout[]
  onEdit: (allocationId: ID) => void
  onDraw: (resourceId: ID, startDate: ISODate, endDate: ISODate) => void
}) {
  const laneRef = useRef<HTMLDivElement>(null)
  const [draw, setDraw] = useState<{ a: number; b: number } | null>(null)
  const teardownRef = useRef<(() => void) | null>(null)
  useEffect(() => () => teardownRef.current?.(), [])

  const indexAt = (clientX: number): number => {
    const rect = laneRef.current?.getBoundingClientRect()
    if (!rect) return 0
    return Math.max(0, Math.min(days.length - 1, Math.floor((clientX - rect.left) / dayWidth)))
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    // Ignore a re-entrant pointerdown (a second finger / pen) while a draw is
    // already live — otherwise its document listeners would leak (overwriting
    // teardownRef) and a single pointerup could fire onDraw twice. Mirrors the
    // guard in useDragResize.
    if (teardownRef.current) return
    const pointerId = e.pointerId // only react to THIS pointer's move/up/cancel
    // Guarded because synthetic/older events may omit pointerId (treat a missing
    // id as "the active pointer").
    const fromOtherPointer = (ev: PointerEvent) => ev.pointerId !== undefined && ev.pointerId !== pointerId
    const startX = e.clientX
    const start = indexAt(e.clientX)
    setDraw({ a: start, b: start })
    const onMove = (ev: PointerEvent) => {
      if (fromOtherPointer(ev)) return
      setDraw({ a: start, b: indexAt(ev.clientX) })
    }
    const detach = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onCancel)
      teardownRef.current = null
    }
    const onUp = (ev: PointerEvent) => {
      if (fromOtherPointer(ev)) return
      detach()
      setDraw(null)
      // A bare click (sub-threshold) is a no-op — matches the bar's click/drag split and
      // avoids popping a "New …" modal on a stray click. Use the row "+" for single-day.
      if (Math.abs(ev.clientX - startX) < DRAW_THRESHOLD_PX) return
      const end = indexAt(ev.clientX)
      onDraw(resourceId, addDaysISO(origin, Math.min(start, end)), addDaysISO(origin, Math.max(start, end)))
    }
    const onCancel = (ev: PointerEvent) => {
      if (fromOtherPointer(ev)) return
      // Browser took over the gesture (e.g. to scroll): drop the ghost, don't create.
      detach()
      setDraw(null)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onCancel)
    teardownRef.current = detach
  }

  return (
    <div
      ref={laneRef}
      data-testid="resource-lane"
      data-resource-id={resourceId}
      role="gridcell"
      className="relative shrink-0 transition-colors"
      style={{ width: totalWidth, height: rowHeight }}
      onPointerDown={onPointerDown}
    >
      {/* week separators (always) */}
      {days.map((d, i) =>
        i !== 0 && weekdayOf(d) === 1 ? (
          <div key={`w-${d}`} className="absolute top-0 h-full border-l border-line" style={{ left: i * dayWidth }} />
        ) : null,
      )}

      {/* weekend / unavailable tint — only at fine zoom (keeps the DOM light when zoomed out) */}
      {dayWidth >= DAY_COLUMN_MIN_WIDTH &&
        days.map((d, i) =>
          dayStates[i]?.unavailable ? (
            <div
              key={`u-${d}`}
              data-testid="unavailable-day"
              className="absolute top-0 h-full bg-base"
              style={{ left: i * dayWidth, width: dayWidth }}
            />
          ) : null,
        )}

      {/* over-allocation markers (any zoom, only on over days): a full-height tint
          plus a solid top band so overbooked days read at a glance, not a hairline */}
      {days.map((d, i) =>
        dayStates[i]?.over ? (
          <div
            key={`o-${d}`}
            data-testid="over-marker"
            title="Overbooked"
            className="pointer-events-none absolute top-0 h-full border-t-[3px] border-danger bg-danger/12"
            style={{ left: i * dayWidth, width: dayWidth }}
          />
        ) : null,
      )}

      {/* time-off blocks (hatched, labelled) */}
      {timeOff.map((b) => (
        <div
          key={b.id}
          data-testid="timeoff-block"
          title={b.note ?? b.label}
          className="pointer-events-none absolute inset-y-1 flex items-center justify-center overflow-hidden rounded text-[10px] font-semibold uppercase tracking-wide text-muted"
          style={{
            left: b.x,
            width: b.width,
            background:
              'repeating-linear-gradient(45deg, color-mix(in oklab, var(--color-faint) 28%, transparent) 0 5px, transparent 5px 10px)',
          }}
        >
          {b.width > 44 ? b.label : ''}
        </div>
      ))}

      {/* draw-to-create ghost */}
      {draw && (
        <div
          className="pointer-events-none absolute rounded border-2 border-brand bg-brand/20"
          style={{
            left: Math.min(draw.a, draw.b) * dayWidth,
            width: (Math.abs(draw.b - draw.a) + 1) * dayWidth,
            top: LAYOUT.rowPadding,
            height: LAYOUT.barHeight,
          }}
        />
      )}

      {bars.map((bar) => (
        <AllocationBar key={bar.allocation.id} bar={bar} dayWidth={dayWidth} onEdit={onEdit} />
      ))}

      {/* today line */}
      {todayX !== null && (
        <div data-testid="today-line" className="pointer-events-none absolute inset-y-0 z-[2] w-px bg-brand/70" style={{ left: todayX }} />
      )}
    </div>
  )
})
