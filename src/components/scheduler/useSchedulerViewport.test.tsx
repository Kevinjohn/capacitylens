import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { useSchedulerViewport } from './useSchedulerViewport'
import { useStore } from '../../store/useStore'

// weekSnap.ts's own floor-snap (weekStartSnapTarget, see weekSnap.test.ts) already rounds
// scrollLeft before geom.indexAt for exactly this HiDPI reason (see its "SUB-PIXEL ROUNDING"
// doc comment). This file pins the SAME rounding at the hook's other two indexAt call sites
// (onScroll's leftEdgeIdx, and visibleStartDate) plus the dragging-end effect, so all three
// resolve a fractional scrollLeft to the column it's essentially already at rather than the
// previous (narrower, under minimised weekends) one.

// A minimal DOM harness: useSchedulerViewport owns a ref, not a rendered element, so the hook
// must be driven through a real scrollable node (renderHook alone never attaches one). Mirrors
// SchedulerGrid.test.tsx's "Feature 2" wiring tests — same clientWidth stub + synchronous rAF —
// but stripped to just the viewport hook, no grid chrome.
function Harness({ minimiseWeekends = false }: { minimiseWeekends?: boolean }) {
  const ui = useStore((s) => s.ui)
  const { scrollRef, leftEdgeIdx, onScroll, visibleStartDate } = useSchedulerViewport({
    ui,
    minimiseWeekends,
    snapToWeekStart: false,
    calendarWeekStartsOn: 1,
  })
  return (
    <div ref={scrollRef} data-testid="scroll" onScroll={onScroll} style={{ overflow: 'auto' }}>
      <div data-testid="left-edge-idx">{leftEdgeIdx}</div>
      <div data-testid="visible-start">{visibleStartDate()}</div>
    </div>
  )
}

describe('useSchedulerViewport — HiDPI sub-pixel scrollLeft rounding', () => {
  // Uniform columns (minimise off): availableWidth 944 / 7 = 134, matching SchedulerGrid.test.tsx's
  // "Feature 2" DAY_WIDTH so the boundary math below is a known, previously-pinned constant.
  const DAY_WIDTH = 134
  let rafSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1200 })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 })
    // Run the onScroll rAF synchronously so its body executes within the dispatched scroll event
    // (same trick as SchedulerGrid.test.tsx's snap-to-week-start suite).
    rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0)
      return 1
    })
    useStore.setState((st) => ({
      ui: { ...st.ui, originDate: '2026-06-01', focusDate: '2026-06-01', zoom: 1, rangeDays: 120, collapsedGroups: [] },
      draggingAllocationId: null,
    }))
  })

  afterEach(() => {
    rafSpy.mockRestore()
    delete (HTMLElement.prototype as unknown as { clientWidth?: number }).clientWidth
    delete (HTMLElement.prototype as unknown as { clientHeight?: number }).clientHeight
  })

  it('onScroll resolves a scrollLeft fractionally below a column boundary to that column, not the previous one', () => {
    render(<Harness />)
    const grid = screen.getByTestId('scroll')
    const boundary = 2 * DAY_WIDTH // index 2 → 2026-06-03

    act(() => {
      grid.scrollLeft = boundary - 0.4
      grid.dispatchEvent(new Event('scroll'))
    })

    // Without rounding, indexAt's strict floor would resolve boundary - 0.4 to index 1
    // (2026-06-02) — the previous column. Rounded first, it lands on the boundary column.
    expect(screen.getByTestId('left-edge-idx').textContent).toBe('2')
    expect(screen.getByTestId('visible-start').textContent).toBe('2026-06-03')
  })

  it('onScroll still resolves an exact boundary scrollLeft to that column (rounding is a no-op there)', () => {
    render(<Harness />)
    const grid = screen.getByTestId('scroll')
    const boundary = 2 * DAY_WIDTH

    act(() => {
      grid.scrollLeft = boundary
      grid.dispatchEvent(new Event('scroll'))
    })

    expect(screen.getByTestId('left-edge-idx').textContent).toBe('2')
    expect(screen.getByTestId('visible-start').textContent).toBe('2026-06-03')
  })

  it('the drag-end resync effect (a third unrounded indexAt call site) resolves the same sub-pixel scrollLeft correctly', () => {
    // Drives the `!dragging` effect (leftEdgeIdx resync when a drag ends) rather than onScroll —
    // it reads scrollRef.current.scrollLeft directly through the same geom.indexAt call.
    useStore.setState({ draggingAllocationId: 'a1' })
    render(<Harness />)
    const grid = screen.getByTestId('scroll')
    const boundary = 3 * DAY_WIDTH // index 3 → 2026-06-04

    act(() => {
      grid.scrollLeft = boundary - 0.4
    })
    act(() => {
      useStore.setState({ draggingAllocationId: null }) // drag ends → resync effect fires
    })

    expect(screen.getByTestId('left-edge-idx').textContent).toBe('3')
    expect(screen.getByTestId('visible-start').textContent).toBe('2026-06-04')
  })
})
