import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { m } from '@/i18n'
import { addDaysISO, weekdayOf } from '@capacitylens/shared/lib/dateMath'
import { useStore } from '../../store/useStore'
import { DAY_COLUMN_MIN_WIDTH } from '../../lib/schedulerConfig'
import { Icon } from '../common/Icon'
import { AllocationBar } from './AllocationBar'
import { LAYOUT } from './layout'
import type { ColumnGeometry } from './columnGeometry'
import type { BarLayout, DayState, TimeOffBlock } from './schedulerModel'
import type { ID, ISODate } from '@capacitylens/shared/types/entities'

/** Min pointer travel to treat a lane gesture as a draw (vs a bare click). */
const DRAW_THRESHOLD_PX = 4

/**
 * The lane's allocation bars, wrapped in ONE transparent layer that carries the time-off-mode
 * `inert`. This is the single place the draw mode is read on the render path: in "Time off" mode
 * the work bars must go fully inert (not tab-stops, no hover popover, pointer events falling
 * THROUGH to the lane so you can draw time off across an existing allocation), and `inert` on this
 * one wrapper makes EVERY descendant bar inert in a single DOM write. The layer is split out from
 * ResourceLane so a mode toggle re-renders ONLY it — not the lane's markers / time-off blocks /
 * separators (which must stay interactive + keep glowing), and not the bars.
 *
 * On a toggle the bars bail PRIMARILY because ResourceLane itself doesn't re-render: SchedulerGrid's
 * `onDraw`/`onEdit` are referentially stable, so the lane's props don't change, so its React.memo
 * bails and only BarsLayer (the sole drawMode subscriber) re-renders — handing each AllocationBar the
 * same props instance it already had. Belt-and-braces, every prop this layer passes down
 * (`bar`, `geom`, `indexAtClientX`, `onEdit`) is ALSO a referentially-STABLE value, so the bail would
 * still hold if some future change made a lane prop unstable and forced ResourceLane to re-render:
 * `bars`/`geom`/`onEdit` are model-derived props unchanged by a toggle, and `indexAtClientX` is
 * `indexAt`, memoised (useCallback) so it survives a lane re-render. Hand a fresh inline
 * closure/array/object down here and that defense-in-depth is gone.
 * `absolute inset-0` makes the layer exactly cover the lane, so the bars' absolute coordinates are
 * unchanged; with no background it's transparent to pointers, so an empty-space draw still reaches
 * the lane underneath.
 *
 * The bars must stay OUTSIDE this wrapper's inert-ness in WORK mode — inert is unset then, so the
 * layer is a no-op pass-through (byte-identical interaction to having the bars as direct children).
 */
const BarsLayer = memo(function BarsLayer({
  bars,
  geom,
  indexAtClientX,
  onEdit,
}: {
  bars: BarLayout[]
  geom: ColumnGeometry
  indexAtClientX: (clientX: number) => number
  // Absent for a Viewer (P1.12): the bars then render display-only (AllocationBar attaches no
  // drag/resize and opens no edit modal). Present for an editor — the stable memoised callback.
  onEdit?: (allocationId: ID) => void
}) {
  const inertInTimeOff = useStore((s) => s.ui.drawMode === 'timeoff')
  return (
    <div className="absolute inset-0" inert={inertInTimeOff || undefined}>
      {bars.map((bar) => (
        <AllocationBar key={bar.allocation.id} bar={bar} geom={geom} indexAtClientX={indexAtClientX} onEdit={onEdit} />
      ))}
    </div>
  )
})

// Memoised so a sibling lane's draw gesture (per-pointermove setDraw) and grid-level
// UI re-renders (e.g. opening a modal) don't re-render every lane + its bars. Its
// props are stable model-derived values; onEdit/onDraw are stabilised in SchedulerGrid.
export const ResourceLane = memo(function ResourceLane({
  resourceId,
  ariaLabel,
  days,
  dayStates,
  timeOff,
  todayX,
  dayWidth,
  geom,
  origin,
  rowHeight,
  bars,
  placeholder = false,
  weekStartsOn,
  onEdit,
  onDraw,
}: {
  resourceId: ID
  /** Accessible name for the lane's role="gridcell" (e.g. "Tyler Nix timeline"). The cell is
   *  column 2 of the grid; naming it keeps the 2-column structure honest (WCAG 1.3.1) without
   *  echoing the rowheader's sr-only capacity summary. */
  ariaLabel: string
  days: ISODate[]
  dayStates: DayState[]
  timeOff: TimeOffBlock[]
  todayX: number | null
  // dayWidth still gates the density thresholds (per-day columns / weekday tint); the
  // pixel POSITIONS all come from geom, which may narrow weekend columns.
  dayWidth: number
  geom: ColumnGeometry
  origin: ISODate
  rowHeight: number
  bars: BarLayout[]
  placeholder?: boolean
  weekStartsOn: 0 | 1
  // Both ABSENT for a Viewer (P1.12): the lane then renders display-only — no draw-to-create gesture,
  // no hover "+" hint, and its bars get no edit/drag/resize. Present for an editor (null/owner/admin/
  // editor, incl. OFF/local) — the stable memoised callbacks, byte-identical to today.
  onEdit?: (allocationId: ID) => void
  onDraw?: (resourceId: ID, startDate: ISODate, endDate: ISODate) => void
}) {
  const laneRef = useRef<HTMLDivElement>(null)
  const [draw, setDraw] = useState<{ a: number; b: number } | null>(null)
  // The day cell under the mouse, for the hover "+" hint. Only updates when the
  // pointer CROSSES a day boundary (setState bails on the same index), so plain
  // mousemove within a cell doesn't re-render the lane.
  const [hoverDay, setHoverDay] = useState<number | null>(null)
  const teardownRef = useRef<(() => void) | null>(null)
  useEffect(() => () => teardownRef.current?.(), [])

  // Wrapped in useCallback (keyed on geom) so the identity is STABLE across a re-render that
  // isn't a real geometry change. `indexAt` is handed down (as `indexAtClientX`) to BarsLayer →
  // every AllocationBar; a fresh inline closure each render would fail their React.memo whenever
  // ResourceLane re-renders. This is defense-in-depth, not the reason the draw-mode toggle is
  // render-free: a toggle doesn't re-render ResourceLane at all (its props are stable, so its memo
  // bails), so indexAt isn't recreated either way. It matters only if some future change makes a
  // lane prop unstable across a toggle and forces ResourceLane to re-render. Keyed on geom alone:
  // laneRef is a stable ref, and geom is the only value the math reads, so the identity changes
  // only when the columns genuinely change.
  const indexAt = useCallback(
    (clientX: number): number => {
      const rect = laneRef.current?.getBoundingClientRect()
      if (!rect) return 0
      // geom.indexAt is the exact inverse of the column layout AND clamps to [0, days.length-1]:
      // a pointerup can land outside the lane (the gesture is tracked on the document, so the
      // pointer may release past either edge), and bounding the untrusted coord here means
      // addDaysISO(origin, idx) always gets a valid offset inside the visible window — a drop
      // past the edge snaps to the first/last day, never an off-window date. This is the SINGLE
      // pointer→day inverse, shared with the bars' drag math (passed to AllocationBar below).
      return geom.indexAt(clientX - rect.left)
    },
    [geom],
  )

  const onPointerDown = (e: React.PointerEvent) => {
    // Viewer (P1.12): no create callback → no draw gesture at all. Bail before any listener is bound
    // so an empty-space press on a read-only lane does nothing (and never starts a ghost).
    if (!onDraw) return
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
      aria-colindex={2}
      aria-label={ariaLabel}
      className="relative shrink-0 transition-colors"
      style={{ width: geom.totalWidth, height: rowHeight }}
      onPointerDown={onPointerDown}
      onPointerMove={(e) => {
        if (!onDraw) return // Viewer (P1.12): no create → no hover "+" hint to track.
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
        const weekStart = weekdayOf(d) === weekStartsOn
        if (!weekStart && dayWidth < DAY_COLUMN_MIN_WIDTH) return null
        return (
          <div
            key={`w-${d}`}
            className={`absolute top-0 h-full border-l ${weekStart ? 'border-line' : 'border-line-faint'}`}
            style={{ left: geom.x(i) }}
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
              className="absolute top-0 h-full bg-weekend"
              style={{ left: geom.x(i), width: geom.widthOf(i) }}
            />
          ) : null,
        )}

      {/* over-allocation markers (any zoom, only on over days — `over` = allocated > available,
          STRICTLY greater; at-or-under capacity is NOT marked): a clear, unmistakable RED
          BACKGROUND so an over-capacity day reads as red at a glance, plus a solid top band for a
          non-colour-alone shape cue. Uses the dedicated `danger-cell` token — a strongly saturated
          red, FAR stronger than the `danger-soft` button tint. This cell carries NO text: the
          allocation bars layered on top (later in DOM order) paint their own opaque, WCAG-tuned
          fills, so the saturated red here has no text-contrast (AA) constraint on it and @axe-core
          stays green even at full strength. The band stays the full `danger` to keep the over edge
          crisp over the fill. */}
      {days.map((d, i) =>
        dayStates[i]?.over ? (
          <div
            key={`o-${d}`}
            data-testid="over-marker"
            title={m.scheduler_over_marker_title()}
            className="pointer-events-none absolute top-0 h-full border-t-[3px] border-danger bg-danger-cell"
            style={{ left: geom.x(i), width: geom.widthOf(i) }}
          />
        ) : null,
      )}

      {/* time-off blocks (hatched, labelled) */}
      {timeOff.map((b) => (
        <div
          key={b.id}
          data-testid="timeoff-block"
          title={b.note ?? b.label}
          // `scheduler-timeoff-block` is the semantic hook the time-off draw-mode CSS glows
          // (index.css), keyed by class — NOT by `data-testid` (which stays test-only selection).
          className="scheduler-timeoff-block pointer-events-none absolute inset-y-1 flex items-center justify-center overflow-hidden rounded text-2xs font-semibold uppercase tracking-wide text-muted"
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
      {onDraw && hoverDay !== null && !draw && dayWidth >= DAY_COLUMN_MIN_WIDTH && (
        <div
          aria-hidden
          data-testid="day-add-hint"
          className="pointer-events-none absolute top-0 flex h-full items-center justify-center text-faint/50"
          style={{ left: geom.x(hoverDay), width: geom.widthOf(hoverDay) }}
        >
          <Icon name="plus" size={14} />
        </div>
      )}

      {/* draw-to-create ghost */}
      {draw && (
        <div
          className="pointer-events-none absolute rounded border-2 border-brand bg-brand/20"
          style={{
            left: geom.x(Math.min(draw.a, draw.b)),
            width: geom.spanWidth(Math.min(draw.a, draw.b), Math.max(draw.a, draw.b)),
            top: LAYOUT.rowPadding,
            height: LAYOUT.barHeight,
          }}
        />
      )}

      <BarsLayer bars={bars} geom={geom} indexAtClientX={indexAt} onEdit={onEdit} />

      {/* today line */}
      {todayX !== null && (
        <div data-testid="today-line" className="pointer-events-none absolute inset-y-0 z-[2] w-0.5 bg-brand" style={{ left: todayX }} />
      )}
    </div>
  )
})
