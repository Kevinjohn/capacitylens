import { memo, useEffect, useRef, useState } from 'react'
import { addDaysISO, weekdayOf } from '@floaty/shared/lib/dateMath'
import { DAY_COLUMN_MIN_WIDTH } from '../../lib/schedulerConfig'
import { Icon } from '../common/Icon'
import { AllocationBar } from './AllocationBar'
import { LAYOUT } from './layout'
import type { BarLayout, DayState, TimeOffBlock } from './schedulerModel'
import type { ID, ISODate } from '@floaty/shared/types/entities'

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
  placeholder = false,
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
  placeholder?: boolean
  onEdit: (allocationId: ID) => void
  onDraw: (resourceId: ID, startDate: ISODate, endDate: ISODate) => void
}) {
  const laneRef = useRef<HTMLDivElement>(null)
  const [draw, setDraw] = useState<{ a: number; b: number } | null>(null)
  // The day cell under the mouse, for the hover "+" hint. Only updates when the
  // pointer CROSSES a day boundary (setState bails on the same index), so plain
  // mousemove within a cell doesn't re-render the lane.
  const [hoverDay, setHoverDay] = useState<number | null>(null)
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
      // A clean click (sub-threshold) creates a SINGLE-day allocation on the clicked
      // day — the most common case, and previously impossible (you had to find the
      // tiny row "+"). A multi-day drag spans clicked-start → release. Grabbing a bar
      // never reaches here (the bar stops propagation), so this only fires on empty space.
      if (Math.abs(ev.clientX - startX) < DRAW_THRESHOLD_PX) {
        const day = addDaysISO(origin, start)
        onDraw(resourceId, day, day)
        return
      }
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
      onPointerMove={(e) => {
        if (e.pointerType !== 'mouse') return // touch/pen have no hover state
        const i = indexAt(e.clientX)
        setHoverDay((prev) => (prev === i ? prev : i))
      }}
      onPointerLeave={() => setHoverDay(null)}
    >
      {/* Placeholder ("slot") rows: a diagonal hatch behind everything else, marking
          the lane as a not-yet-staffed slot. First child so separators/markers/bars
          paint on top. */}
      {placeholder && <div aria-hidden className="hatch-lines pointer-events-none absolute inset-0" />}

      {/* Vertical separators: Mondays draw the full week line at any zoom; the other
          days get a barely-there hairline so Mon/Tue/Wed read as columns — fine zoom
          only, same DOM-weight rule as the weekend tint below. */}
      {days.map((d, i) => {
        if (i === 0) return null
        const weekStart = weekdayOf(d) === 1
        if (!weekStart && dayWidth < DAY_COLUMN_MIN_WIDTH) return null
        return (
          <div
            key={`w-${d}`}
            className={`absolute top-0 h-full border-l ${weekStart ? 'border-line' : 'border-line-faint'}`}
            style={{ left: i * dayWidth }}
          />
        )
      })}

      {/* weekend / unavailable tint — only at fine zoom (keeps the DOM light when zoomed out) */}
      {dayWidth >= DAY_COLUMN_MIN_WIDTH &&
        days.map((d, i) =>
          dayStates[i]?.unavailable ? (
            <div
              key={`u-${d}`}
              data-testid="unavailable-day"
              className="absolute top-0 h-full bg-canvas"
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
          className="pointer-events-none absolute inset-y-1 flex items-center justify-center overflow-hidden rounded text-2xs font-semibold uppercase tracking-wide text-muted"
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

      {/* Hover hint: a faint "+" in the day cell under the mouse, advertising that a
          bare click creates an allocation right there (the lane gesture above) — the
          row-header "+" was the only visible cue. Decorative (aria-hidden) and very
          light on purpose. Mouse-only, fine-zoom only (no room for it in 8px columns),
          hidden while a draw is live (the ghost is the affordance then). Painted
          before the bars so scheduled work covers it. */}
      {hoverDay !== null && !draw && dayWidth >= DAY_COLUMN_MIN_WIDTH && (
        <div
          aria-hidden
          data-testid="day-add-hint"
          className="pointer-events-none absolute top-0 flex h-full items-center justify-center text-faint/50"
          style={{ left: hoverDay * dayWidth, width: dayWidth }}
        >
          <Icon name="plus" size={14} />
        </div>
      )}

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
