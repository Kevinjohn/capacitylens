import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { format } from 'date-fns'
import { useStore } from '../../store/useStore'
import { useDragResize } from '../../hooks/useDragResize'
import { applyGesture, type DragMode } from '../../lib/gestureMath'
import { readableTextColor } from '../../lib/color'
import { parseDate } from '../../lib/dateMath'
import { ALLOCATION_STATUS_LABELS } from '../../lib/metadata'
import { LAYOUT } from './layout'
import type { BarLayout } from './schedulerModel'

interface LaneSnapshot {
  id: string
  el: HTMLElement
  rect: DOMRect
}

/** Snapshot lane rects once at drag start — avoids a full-document querySelectorAll +
 *  getBoundingClientRect on every pointermove (layout thrash). A drag doesn't scroll the grid. */
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

export function AllocationBar({ bar, dayWidth, onEdit }: { bar: BarLayout; dayWidth: number; onEdit: () => void }) {
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

  // Clear any drop highlight if this bar unmounts mid-drag (e.g. undo).
  useEffect(
    () => () => {
      dropElRef.current?.removeAttribute('data-droptarget')
      dropElRef.current = null
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
    onClick: onEdit,
    onCancel: () => {
      // Gesture cancelled (e.g. the browser stole the pointer to scroll) — abort cleanly.
      setPreview(null)
      setDropTarget(null)
    },
    onCommit: (mode, deltaDays, pointer) => {
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
      } catch (e) {
        // Reassignment rejected (e.g. a placeholder bound to another project): tell
        // the user why instead of silently snapping back, and still apply any date move.
        if (deltaDays !== 0) updateAllocation(bar.allocation.id, dates)
        setNotice(e instanceof Error ? e.message : 'That allocation could not be moved there.')
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
  const textColor = readableTextColor(bar.color)

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
        aria-label={`${bar.label}, ${bar.allocation.hoursPerDay}h per day, ${bar.allocation.status}, ${bar.allocation.startDate} to ${bar.allocation.endDate}. Press Enter to edit.`}
        onPointerDown={(e) => {
          hidePopover()
          lanesRef.current = snapshotLanes()
          onPointerDown(e)
        }}
        onMouseEnter={showPopover}
        onMouseLeave={hidePopover}
        onFocus={showPopover}
        onBlur={hidePopover}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onEdit()
          }
        }}
        className={`group absolute flex select-none items-center overflow-hidden rounded-md text-xs font-medium shadow-sm ring-1 ring-black/10 transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${dragging ? 'shadow-lg' : ''}`}
        style={{
          left,
          width,
          top: bar.top,
          height: LAYOUT.barHeight,
          backgroundColor: bar.color,
          color: textColor,
          opacity: tentative ? 0.62 : 1,
          border: tentative ? `1px dashed ${textColor}` : undefined,
          transform: translateY ? `translateY(${translateY}px)` : undefined,
          zIndex: dragging ? 50 : undefined,
          cursor: dragging ? 'grabbing' : 'grab',
          touchAction: 'none', // bar drag/resize should win over the browser's touch-scroll
        }}
      >
        <span data-handle="start" data-testid="resize-start" className={`left-0 ${gripClass}`}>
          {gripLine}
        </span>
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
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/10" style={{ backgroundColor: bar.color }} />
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
          </div>,
          document.body,
        )}
    </>
  )
}
