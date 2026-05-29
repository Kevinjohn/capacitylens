import { useEffect, useState } from 'react'
import { useStore } from '../../store/useStore'
import { useDragResize } from '../../hooks/useDragResize'
import { applyGesture, type DragMode } from '../../lib/gestureMath'
import { readableTextColor } from '../../lib/color'
import { LAYOUT } from './layout'
import type { BarLayout } from './schedulerModel'

/** Find the resource row whose lane contains the drop point (by data-resource-id). */
function resourceLaneAt(clientX: number, clientY: number): string | null {
  const lanes = Array.from(document.querySelectorAll<HTMLElement>('[data-resource-id]'))
  for (const el of lanes) {
    const r = el.getBoundingClientRect()
    if (clientY >= r.top && clientY <= r.bottom && clientX >= r.left && clientX <= r.right) {
      return el.getAttribute('data-resource-id')
    }
  }
  return null
}

/** Highlight the row currently being dragged over (or clear, when null). */
function markDropTarget(resourceId: string | null) {
  document.querySelectorAll<HTMLElement>('[data-resource-id]').forEach((el) => {
    if (resourceId && el.dataset.resourceId === resourceId) el.setAttribute('data-droptarget', '')
    else el.removeAttribute('data-droptarget')
  })
}

export function AllocationBar({ bar, dayWidth, onEdit }: { bar: BarLayout; dayWidth: number; onEdit: () => void }) {
  const updateAllocation = useStore((s) => s.updateAllocation)
  const setNotice = useStore((s) => s.setNotice)
  const [preview, setPreview] = useState<{ mode: DragMode; deltaDays: number; deltaY: number } | null>(null)

  // Clear any drop highlight if this bar unmounts mid-drag (e.g. undo).
  useEffect(() => () => markDropTarget(null), [])

  const { onPointerDown } = useDragResize({
    dayWidth,
    onPreview: (mode, deltaDays, deltaY, pointer) => {
      setPreview({ mode, deltaDays, deltaY })
      if (mode === 'move') {
        const target = resourceLaneAt(pointer.clientX, pointer.clientY)
        markDropTarget(target && target !== bar.allocation.resourceId ? target : null)
      }
    },
    onClick: onEdit,
    onCancel: () => {
      // Gesture cancelled (e.g. the browser stole the pointer to scroll) — abort cleanly.
      setPreview(null)
      markDropTarget(null)
    },
    onCommit: (mode, deltaDays, pointer) => {
      setPreview(null)
      markDropTarget(null)
      const current = { startDate: bar.allocation.startDate, endDate: bar.allocation.endDate }
      const dates = deltaDays !== 0 ? applyGesture(mode, current, deltaDays) : current

      // Dropping on another resource's row reassigns the allocation.
      const target = mode === 'move' ? resourceLaneAt(pointer.clientX, pointer.clientY) : null
      const reassignTo = target && target !== bar.allocation.resourceId ? target : null

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

  return (
    <div
      data-testid="allocation-bar"
      data-alloc-id={bar.allocation.id}
      data-status={bar.allocation.status}
      role="button"
      tabIndex={0}
      aria-label={`${bar.label}, ${bar.allocation.hoursPerDay}h per day, ${bar.allocation.status}, ${bar.allocation.startDate} to ${bar.allocation.endDate}. Press Enter to edit.`}
      onPointerDown={onPointerDown}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onEdit()
        }
      }}
      title={`${bar.label} · ${bar.allocation.hoursPerDay}h/day · ${bar.allocation.status}${bar.allocation.note ? ` · ${bar.allocation.note}` : ''}`}
      className={`absolute flex select-none items-center overflow-hidden rounded-md text-xs font-medium shadow-sm ring-1 ring-black/10 transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${dragging ? 'shadow-lg' : ''}`}
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
      }}
    >
      <span data-handle="start" data-testid="resize-start" className="absolute inset-y-0 left-0 w-1.5" style={{ cursor: 'ew-resize' }} />
      <span className="truncate px-2">
        {completed ? '✓ ' : ''}
        {bar.label} · {bar.allocation.hoursPerDay}h
        {bar.allocation.note ? ' •' : ''}
      </span>
      <span data-handle="end" data-testid="resize-end" className="absolute inset-y-0 right-0 w-1.5" style={{ cursor: 'ew-resize' }} />
    </div>
  )
}
