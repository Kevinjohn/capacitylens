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

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    e.stopPropagation() // don't let the lane start a draw-to-create gesture

    const handle = (e.target as HTMLElement).dataset.handle
    const mode: DragMode = handle === 'start' ? 'resize-start' : handle === 'end' ? 'resize-end' : 'move'
    const startX = e.clientX
    const startY = e.clientY
    const threshold = argsRef.current.threshold ?? 4
    let dragging = false

    const onMove = (ev: PointerEvent) => {
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
    const onCancel = () => {
      detach()
      if (dragging) argsRef.current.onCancel?.()
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onCancel)
    teardownRef.current = detach
  }, [])

  return { onPointerDown }
}
