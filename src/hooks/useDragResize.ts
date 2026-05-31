import { useCallback, useEffect, useRef } from 'react'
import { snapDeltaToDays, type DragMode } from '../lib/gestureMath'

// Thin DOM wrapper over the pure gestureMath. Mode comes from a `data-handle` on
// the pressed element (resize grips) or defaults to 'move'. During the gesture it
// reports a horizontal day-delta plus a raw vertical pixel-delta (for cross-row
// drag preview); on pointerup it commits once and passes the drop coordinates so
// the caller can resolve a target row. A sub-threshold gesture is a click.
// Listeners are torn down on unmount so an interrupted drag can't commit stale.

export interface Pointer {
  clientX: number
  clientY: number
}

export interface UseDragResizeArgs {
  dayWidth: number
  onPreview: (mode: DragMode, deltaDays: number, deltaY: number, pointer: Pointer) => void
  onCommit: (mode: DragMode, deltaDays: number, pointer: Pointer) => void
  onClick?: () => void
  /** Pointer was cancelled mid-gesture (e.g. the browser took over for scrolling). */
  onCancel?: () => void
  threshold?: number
}

export function useDragResize(args: UseDragResizeArgs) {
  const argsRef = useRef(args)
  useEffect(() => {
    argsRef.current = args
  })

  const teardownRef = useRef<(() => void) | null>(null)
  useEffect(() => () => teardownRef.current?.(), [])

  // Returns true when the gesture was ARMED (listeners attached), false when the
  // pointerdown was ignored (non-left button or re-entrant). The caller uses this to
  // avoid starting side effects (e.g. a scroll watcher) for a gesture that never runs
  // — those have no onCommit/onCancel/onClick to tear them back down.
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>): boolean => {
    if (e.button !== 0) return false
    e.stopPropagation() // don't let the lane start a draw-to-create gesture
    // Ignore a re-entrant pointerdown (a second finger / pen) while a gesture is
    // already live — otherwise its document listeners would leak and a single
    // pointerup could commit twice.
    if (teardownRef.current) return false

    const handle = (e.target as HTMLElement).dataset.handle
    const mode: DragMode = handle === 'start' ? 'resize-start' : handle === 'end' ? 'resize-end' : 'move'
    const startX = e.clientX
    const startY = e.clientY
    const pointerId = e.pointerId // only react to THIS pointer's move/up/cancel
    const threshold = argsRef.current.threshold ?? 4
    let dragging = false

    // Only react to THIS pointer. Guarded because synthetic/older events may omit
    // pointerId (treat a missing id as "the active pointer").
    const fromOtherPointer = (ev: PointerEvent) => ev.pointerId !== undefined && ev.pointerId !== pointerId

    const onMove = (ev: PointerEvent) => {
      if (fromOtherPointer(ev)) return
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (!dragging && Math.max(Math.abs(dx), Math.abs(dy)) < threshold) return
      dragging = true
      argsRef.current.onPreview(mode, snapDeltaToDays(dx, argsRef.current.dayWidth), dy, {
        clientX: ev.clientX,
        clientY: ev.clientY,
      })
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
      if (!dragging) {
        argsRef.current.onClick?.()
        return
      }
      argsRef.current.onCommit(mode, snapDeltaToDays(ev.clientX - startX, argsRef.current.dayWidth), {
        clientX: ev.clientX,
        clientY: ev.clientY,
      })
    }
    const onCancel = (ev: PointerEvent) => {
      if (fromOtherPointer(ev)) return
      detach()
      if (dragging) argsRef.current.onCancel?.()
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onCancel)
    teardownRef.current = detach
    return true
  }, [])

  return { onPointerDown }
}
