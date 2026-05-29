import { useEffect, useRef, useState } from 'react'
import { addDaysISO } from '../../lib/dateMath'
import { AllocationBar, type BarLayout } from './AllocationBar'
import { LAYOUT } from './layout'
import type { ID, ISODate } from '../../types/entities'

export interface DayState {
  over: boolean
  unavailable: boolean
}

export interface TimeOffBlock {
  id: ID
  x: number
  width: number
  label: string
  note?: string
}

export function ResourceLane({
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
    const start = indexAt(e.clientX)
    setDraw({ a: start, b: start })
    const onMove = (ev: PointerEvent) => setDraw({ a: start, b: indexAt(ev.clientX) })
    const detach = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      teardownRef.current = null
    }
    const onUp = (ev: PointerEvent) => {
      detach()
      const end = indexAt(ev.clientX)
      setDraw(null)
      onDraw(resourceId, addDaysISO(origin, Math.min(start, end)), addDaysISO(origin, Math.max(start, end)))
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    teardownRef.current = detach
  }

  return (
    <div
      ref={laneRef}
      data-testid="resource-lane"
      data-resource-id={resourceId}
      className="relative shrink-0 transition-colors"
      style={{ width: totalWidth, height: rowHeight }}
      onPointerDown={onPointerDown}
    >
      {/* day grid + capacity tints */}
      {days.map((d, i) => {
        const st = dayStates[i]
        return (
          <div
            key={d}
            data-testid={st?.unavailable ? 'unavailable-day' : undefined}
            className={`absolute top-0 h-full border-r border-line ${st?.unavailable ? 'bg-base' : ''}`}
            style={{ left: i * dayWidth, width: dayWidth }}
          >
            {st?.over && <div data-testid="over-marker" className="absolute inset-x-0 top-0 h-1 bg-danger" />}
          </div>
        )
      })}

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
        <AllocationBar key={bar.allocation.id} bar={bar} dayWidth={dayWidth} onEdit={() => onEdit(bar.allocation.id)} />
      ))}

      {/* today line */}
      {todayX !== null && (
        <div className="pointer-events-none absolute inset-y-0 z-[2] w-px bg-brand/70" style={{ left: todayX }} />
      )}
    </div>
  )
}
