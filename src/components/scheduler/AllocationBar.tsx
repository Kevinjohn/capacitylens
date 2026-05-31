import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { format } from 'date-fns'
import { useStore } from '../../store/useStore'
import { useDragResize } from '../../hooks/useDragResize'
import { applyGesture, type DragMode } from '../../lib/gestureMath'
import { ensureBarColors } from '@floaty/shared/lib/color'
import { capacityAdvisory } from '../../lib/capacity'
import { parseDate } from '@floaty/shared/lib/dateMath'
import { ALLOCATION_STATUS_LABELS } from '../../lib/metadata'
import { LAYOUT } from './layout'
import type { ID } from '@floaty/shared/types/entities'
import type { BarLayout } from './schedulerModel'

interface LaneSnapshot {
  id: string
  el: HTMLElement
  rect: DOMRect
}

/** Snapshot lane rects once at drag start — avoids a full-document querySelectorAll +
 *  getBoundingClientRect on every pointermove (layout thrash). Re-snapshotted on scroll. */
function snapshotLanes(): LaneSnapshot[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-resource-id]')).map((el) => ({
    id: el.getAttribute('data-resource-id') ?? '',
    el,
    rect: el.getBoundingClientRect(),
  }))
}

/** Hit-test the drop point against the cached lane rects. */
function laneAt(lanes: LaneSnapshot[], clientX: number, clientY: number): LaneSnapshot | null {
  for (const l of lanes) {
    const r = l.rect
    if (clientY >= r.top && clientY <= r.bottom && clientX >= r.left && clientX <= r.right) return l
  }
  return null
}

export const AllocationBar = memo(function AllocationBar({
  bar,
  dayWidth,
  onEdit,
}: {
  bar: BarLayout
  dayWidth: number
  // Takes the allocation id so the prop is a STABLE reference (the lane passes the
  // same callback for every bar) — which is what lets React.memo skip re-renders.
  onEdit: (id: ID) => void
}) {
  const updateAllocation = useStore((s) => s.updateAllocation)
  const setNotice = useStore((s) => s.setNotice)
  const [preview, setPreview] = useState<{ mode: DragMode; deltaDays: number; deltaY: number } | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const resourceId = bar.allocation.resourceId
  // Hover/focus detail popover (real card, available to keyboard too — replaces the title tooltip).
  const [pop, setPop] = useState<{ left: number; top: number } | null>(null)
  const showPopover = () => {
    const r = barRef.current?.getBoundingClientRect()
    if (r) setPop({ left: r.left, top: r.bottom + 6 })
  }
  const hidePopover = () => setPop(null)

  // Lane rects snapshotted at drag start; the drop highlight is toggled on just the
  // changed element (no per-move full-document query + class sweep).
  const lanesRef = useRef<LaneSnapshot[]>([])
  const dropElRef = useRef<HTMLElement | null>(null)
  const setDropTarget = (el: HTMLElement | null) => {
    if (dropElRef.current === el) return
    dropElRef.current?.removeAttribute('data-droptarget')
    el?.setAttribute('data-droptarget', '')
    dropElRef.current = el
  }

  // Keep the cached lane rects fresh if the grid scrolls mid-drag (scroll events
  // don't bubble, so listen in the capture phase). Otherwise a drop after a scroll
  // would hit-test against stale rects and reassign to the wrong row.
  const scrollWatchRef = useRef<(() => void) | null>(null)
  const startScrollWatch = () => {
    // rAF-coalesce: scroll can fire many times per frame, and each re-snapshot is a
    // querySelectorAll + getBoundingClientRect over every lane — collapse to one per frame.
    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        lanesRef.current = snapshotLanes()
      })
    }
    document.addEventListener('scroll', onScroll, true)
    scrollWatchRef.current = () => {
      document.removeEventListener('scroll', onScroll, true)
      if (raf) cancelAnimationFrame(raf)
    }
  }
  const stopScrollWatch = () => {
    scrollWatchRef.current?.()
    scrollWatchRef.current = null
  }

  // Clear any drop highlight / scroll watch if this bar unmounts mid-drag (e.g. undo).
  useEffect(
    () => () => {
      dropElRef.current?.removeAttribute('data-droptarget')
      dropElRef.current = null
      stopScrollWatch()
    },
    [],
  )

  const { onPointerDown } = useDragResize({
    dayWidth,
    onPreview: (mode, deltaDays, deltaY, pointer) => {
      setPreview({ mode, deltaDays, deltaY })
      if (mode === 'move') {
        const target = laneAt(lanesRef.current, pointer.clientX, pointer.clientY)
        setDropTarget(target && target.id !== resourceId ? target.el : null)
      }
    },
    onClick: () => {
      stopScrollWatch()
      onEdit(bar.allocation.id)
    },
    onCancel: () => {
      // Gesture cancelled (e.g. the browser stole the pointer to scroll) — abort cleanly.
      stopScrollWatch()
      setPreview(null)
      setDropTarget(null)
    },
    onCommit: (mode, deltaDays, pointer) => {
      stopScrollWatch()
      setPreview(null)
      const current = { startDate: bar.allocation.startDate, endDate: bar.allocation.endDate }
      const dates = deltaDays !== 0 ? applyGesture(mode, current, deltaDays) : current

      // Dropping on another resource's row reassigns the allocation.
      const target = mode === 'move' ? laneAt(lanesRef.current, pointer.clientX, pointer.clientY) : null
      const reassignTo = target && target.id !== resourceId ? target.id : null
      setDropTarget(null)

      if (deltaDays === 0 && !reassignTo) return
      try {
        updateAllocation(bar.allocation.id, reassignTo ? { ...dates, resourceId: reassignTo } : dates)
        // Confirm the commit + advertise undo, and run the SAME capacity advisory the
        // modal shows so the two write paths stay consistent. Read the store imperatively
        // (getState, not a subscription) so this stays off the bar's render/memo path.
        const rid = reassignTo ?? resourceId
        const { data } = useStore.getState()
        const resource = data.resources.find((r) => r.id === rid)
        let advisory = ''
        if (resource) {
          const others = data.allocations.filter((a) => a.resourceId === rid && a.id !== bar.allocation.id)
          const overTimeOff = data.timeOff.filter((t) => t.resourceId === rid)
          const { overDays, timeOffDays } = capacityAdvisory(resource, others, overTimeOff, dates.startDate, dates.endDate, bar.allocation.hoursPerDay)
          const bits: string[] = []
          if (overDays) bits.push(`over capacity on ${overDays} ${overDays === 1 ? 'day' : 'days'}`)
          if (timeOffDays) bits.push(`on time off for ${timeOffDays} ${timeOffDays === 1 ? 'day' : 'days'}`)
          if (bits.length) advisory = ` — now ${bits.join(' and ')}`
        }
        setNotice(`${reassignTo ? 'Allocation reassigned' : 'Allocation moved'}${advisory}. Press ⌘Z to undo.`)
      } catch (e) {
        // Reassignment rejected (e.g. a placeholder bound to another project): tell
        // the user why instead of silently snapping back, and still apply any date move.
        if (deltaDays !== 0) updateAllocation(bar.allocation.id, dates)
        setNotice(e instanceof Error ? e.message : 'That allocation could not be moved there.', 'error')
      }
    },
  })

  let left = bar.x
  let width = bar.width
  let translateY = 0
  if (preview) {
    const d = preview.deltaDays * dayWidth
    if (preview.mode === 'move') {
      left = bar.x + d
      translateY = preview.deltaY
    } else if (preview.mode === 'resize-start') {
      const dd = Math.min(d, bar.width - dayWidth)
      left = bar.x + dd
      width = bar.width - dd
    } else {
      width = Math.max(dayWidth, bar.width + d)
    }
  }

  const dragging = preview !== null
  const tentative = bar.allocation.status === 'tentative'
  const completed = bar.allocation.status === 'completed'
  // Nudge the bar colour so the label clears WCAG AA against its ink (many mid-tones don't).
  // Memoised on the colour: the 0–30-iteration contrast loop must not re-run on every render.
  const { bg, ink } = useMemo(() => ensureBarColors(bar.color), [bar.color])

  // Keyboard equivalent of drag: ←/→ move a day, Shift+←/→ resize the end a day.
  const nudge = (mode: DragMode, delta: number) => {
    const next = applyGesture(mode, { startDate: bar.allocation.startDate, endDate: bar.allocation.endDate }, delta)
    if (next.endDate < next.startDate) return
    try {
      updateAllocation(bar.allocation.id, next)
    } catch {
      /* e.g. integrity rejected — ignore, the bar stays put */
    }
  }

  const fmt = (d: string) => format(parseDate(d), 'd MMM')
  const gripClass = 'group/grip absolute inset-y-0 flex w-2.5 cursor-ew-resize items-center justify-center'
  const gripLine = <span aria-hidden className="pointer-events-none h-4 w-0.5 rounded-full bg-current opacity-0 transition-opacity group-hover:opacity-60" />

  return (
    <>
      <div
        ref={barRef}
        data-testid="allocation-bar"
        data-alloc-id={bar.allocation.id}
        data-status={bar.allocation.status}
        role="button"
        tabIndex={0}
        aria-label={`${bar.label}, ${bar.allocation.hoursPerDay}h per day, ${bar.allocation.status}, ${bar.allocation.startDate} to ${bar.allocation.endDate}. Enter to edit; arrow keys to move, Shift+arrow to resize the end, Alt+arrow to resize the start; drag to another row to reassign.`}
        onPointerDown={(e) => {
          hidePopover()
          // Only snapshot lanes + watch scroll once the gesture is actually armed.
          // An ignored pointerdown (non-left button / re-entrant) has no
          // onCommit/onCancel/onClick to stop the scroll watcher, so starting it
          // here would leak the document scroll listener until unmount.
          if (!onPointerDown(e)) return
          lanesRef.current = snapshotLanes()
          startScrollWatch()
        }}
        onMouseEnter={showPopover}
        onMouseLeave={hidePopover}
        onFocus={showPopover}
        onBlur={hidePopover}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onEdit(bar.allocation.id)
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault()
            // Alt = resize the start edge, Shift = resize the end edge, neither = move.
            const mode = e.altKey ? 'resize-start' : e.shiftKey ? 'resize-end' : 'move'
            nudge(mode, e.key === 'ArrowRight' ? 1 : -1)
          }
        }}
        className={`group absolute flex select-none items-center overflow-hidden rounded-md text-xs font-medium shadow-sm ring-1 ring-black/10 transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${dragging ? 'shadow-lg' : ''}`}
        style={{
          left,
          width,
          top: bar.top,
          height: LAYOUT.barHeight,
          backgroundColor: bg,
          color: ink,
          // Tentative is signalled by the dashed border + hatch overlay below — NOT by
          // element opacity, which used to wash out the label and break its contrast.
          border: tentative ? `1px dashed ${ink}` : undefined,
          transform: translateY ? `translateY(${translateY}px)` : undefined,
          zIndex: dragging ? 50 : undefined,
          cursor: dragging ? 'grabbing' : 'grab',
          touchAction: 'none', // bar drag/resize should win over the browser's touch-scroll
        }}
      >
        <span data-handle="start" data-testid="resize-start" className={`left-0 ${gripClass}`}>
          {gripLine}
        </span>
        {tentative && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ background: 'repeating-linear-gradient(45deg, color-mix(in oklab, currentColor 16%, transparent) 0 4px, transparent 4px 8px)' }}
          />
        )}
        <span className="truncate px-2.5">
          {completed ? '✓ ' : ''}
          {bar.label} · {bar.allocation.hoursPerDay}h
          {bar.allocation.note ? ' •' : ''}
        </span>
        <span data-handle="end" data-testid="resize-end" className={`right-0 ${gripClass}`}>
          {gripLine}
        </span>
      </div>

      {pop &&
        !dragging &&
        createPortal(
          <div
            data-testid="allocation-popover"
            aria-hidden
            className="pointer-events-none fixed z-[60] w-60 rounded-lg bg-elevated p-3 text-xs text-ink shadow-pop ring-1 ring-line"
            style={{ left: pop.left, top: pop.top }}
          >
            <div className="mb-1 flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/10" style={{ backgroundColor: bg }} />
              <span className="font-semibold">{bar.label}</span>
            </div>
            {(bar.project || bar.client) && (
              <div className="mb-1 text-muted">
                {bar.project}
                {bar.project && bar.client ? ' · ' : ''}
                {bar.client}
              </div>
            )}
            <div className="text-muted">
              {fmt(bar.allocation.startDate)} – {fmt(bar.allocation.endDate)} · {bar.allocation.hoursPerDay}h/day · {ALLOCATION_STATUS_LABELS[bar.allocation.status]}
            </div>
            {bar.allocation.note && <div className="mt-1 border-t border-line pt-1 text-muted">{bar.allocation.note}</div>}
            <div className="mt-1 border-t border-line pt-1 text-2xs text-faint">
              Drag to move · edges to resize · drop on another row to reassign
            </div>
          </div>,
          document.body,
        )}
    </>
  )
})
