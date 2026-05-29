import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useDragResize } from './useDragResize'
import type { DragMode } from '../lib/gestureMath'

interface HarnessProps {
  dayWidth?: number
  onPreview?: (mode: DragMode, deltaDays: number, deltaY: number, pointer: { clientX: number; clientY: number }) => void
  onCommit: (mode: DragMode, deltaDays: number, pointer: { clientX: number; clientY: number }) => void
  onClick?: () => void
}

function Harness({ dayWidth = 48, onPreview = vi.fn(), onCommit, onClick }: HarnessProps) {
  const { onPointerDown } = useDragResize({ dayWidth, onPreview, onCommit, onClick })
  return (
    <div data-testid="drag-target" onPointerDown={onPointerDown}>
      <span data-handle="start" data-testid="handle-start">start</span>
      <span data-handle="end" data-testid="handle-end">end</span>
      <span data-testid="body">body</span>
    </div>
  )
}

beforeEach(() => {
  // Clean up any stray document listeners between tests
})

describe('useDragResize', () => {
  it('(a) pointerDown on the body + pointermove >4px + pointerup calls onCommit with mode "move" and deltaDays=1 for 48px', () => {
    const onCommit = vi.fn()
    const onClick = vi.fn()
    render(<Harness onCommit={onCommit} onClick={onClick} />)

    const body = screen.getByTestId('body')

    // Start drag on the body span (no data-handle => 'move' mode)
    fireEvent.pointerDown(body, { clientX: 0, button: 0 })

    // Move >4px threshold
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 48, bubbles: true }))

    // Release
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 48, bubbles: true }))

    expect(onCommit).toHaveBeenCalledWith('move', 1, expect.objectContaining({ clientX: 48 }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('(b) pointerDown then pointerup with no move calls onClick', () => {
    const onCommit = vi.fn()
    const onClick = vi.fn()
    render(<Harness onCommit={onCommit} onClick={onClick} />)

    const body = screen.getByTestId('body')

    // Pointer down
    fireEvent.pointerDown(body, { clientX: 100, button: 0 })

    // Pointer up at the same position (no movement)
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 100, bubbles: true }))

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('(c) pointerDown on data-handle="end" + move + pointerup calls onCommit with mode "resize-end"', () => {
    const onCommit = vi.fn()
    const onClick = vi.fn()
    render(<Harness onCommit={onCommit} onClick={onClick} />)

    const endHandle = screen.getByTestId('handle-end')

    // Start drag on end handle
    fireEvent.pointerDown(endHandle, { clientX: 0, button: 0 })

    // Move 48px (1 day worth)
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 48, bubbles: true }))

    // Release
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 48, bubbles: true }))

    expect(onCommit).toHaveBeenCalledWith('resize-end', 1, expect.objectContaining({ clientX: 48 }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('ignores non-primary mouse buttons', () => {
    const onCommit = vi.fn()
    const onClick = vi.fn()
    render(<Harness onCommit={onCommit} onClick={onClick} />)

    const body = screen.getByTestId('body')

    // Right-click (button=2) should be ignored
    fireEvent.pointerDown(body, { clientX: 0, button: 2 })
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 96, bubbles: true }))
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 96, bubbles: true }))

    expect(onCommit).not.toHaveBeenCalled()
    expect(onClick).not.toHaveBeenCalled()
  })
})
