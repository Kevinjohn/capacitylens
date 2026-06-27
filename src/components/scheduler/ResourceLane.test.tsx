import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { ResourceLane } from './ResourceLane'
import { buildColumnGeometry } from './columnGeometry'
import type { BarLayout, DayState, TimeOffBlock } from './schedulerModel'
import { useStore } from '../../store/useStore'
import { emptyAppData } from '@capacitylens/shared/types/entities'

beforeEach(() => {
  useStore.getState().replaceAll(emptyAppData())
  useStore.getState().clearFilters()
})

const DAYS: [string, string, string] = ['2026-06-01', '2026-06-02', '2026-06-03']
const DAY_WIDTH = 48
const ORIGIN = '2026-06-01'
const GEOM = buildColumnGeometry(DAYS, DAY_WIDTH, { minimiseWeekends: false, weekendWidth: 22 })

const DAY_STATES: DayState[] = [
  { unavailable: true, over: false },
  { unavailable: false, over: true },
  { unavailable: false, over: false },
]

const TIME_OFF_BLOCKS: TimeOffBlock[] = [
  { id: 'to1', x: 0, width: 96, label: 'Holiday' },
]

const makeBar = (): BarLayout => ({
  allocation: {
    id: 'alloc1',
    accountId: 'acct-test',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    resourceId: 'r1',
    activityId: 't1',
    startDate: '2026-06-01',
    endDate: '2026-06-02',
    hoursPerDay: 8,
    status: 'confirmed',
  },
  x: 0,
  width: 96,
  top: 6,
  color: '#2563eb',
  label: 'My Activity',
  external: false,
})

function renderLane(overrides: Partial<Parameters<typeof ResourceLane>[0]> = {}) {
  const onEdit = vi.fn()
  const onDraw = vi.fn()

  render(
    <ResourceLane
      resourceId="r1"
      ariaLabel="Resource one timeline"
      days={DAYS}
      dayStates={DAY_STATES}
      timeOff={TIME_OFF_BLOCKS}
      todayX={48}
      dayWidth={DAY_WIDTH}
      geom={GEOM}
      origin={ORIGIN}
      rowHeight={52}
      bars={[makeBar()]}
      weekStartsOn={1}
      onEdit={onEdit}
      onDraw={onDraw}
      {...overrides}
    />,
  )

  return { onEdit, onDraw }
}

describe('ResourceLane rendering', () => {
  it('renders an unavailable-day marker for the unavailable day', () => {
    renderLane()
    expect(screen.getByTestId('unavailable-day')).toBeInTheDocument()
  })

  it('renders an over-marker (red background) for the over day', () => {
    renderLane()
    const marker = screen.getByTestId('over-marker')
    expect(marker).toBeInTheDocument()
    // The user-facing point: a CLEAR, saturated red background, not a faint tint. Lock the
    // dedicated `danger-cell` token class so a regression back to the subtle `bg-danger/12`
    // alpha or the pale `danger-soft` button tint reds the gate.
    expect(marker).toHaveClass('bg-danger-cell')
  })

  // The render-layer boundary mirroring the pure-fn boundary: a day that is at-or-under
  // capacity carries `over: false`, so NO over-marker / red background renders for it.
  it('does NOT render an over-marker when no day is over (at-or-under capacity)', () => {
    renderLane({
      dayStates: [
        { unavailable: false, over: false },
        { unavailable: false, over: false },
        { unavailable: false, over: false },
      ],
    })
    expect(screen.queryByTestId('over-marker')).not.toBeInTheDocument()
  })

  it('renders a timeoff-block for the time off entry', () => {
    renderLane()
    expect(screen.getByTestId('timeoff-block')).toBeInTheDocument()
  })

  it('keeps the time-off label available to AT even when too narrow for the visible label (WCAG 1.3.1)', () => {
    // A 30px block drops the VISIBLE uppercase label (<=44px), but the sr-only span must still name it.
    renderLane({ timeOff: [{ id: 'to1', x: 0, width: 30, label: 'Holiday' }] })
    const block = screen.getByTestId('timeoff-block')
    // The specific label survives in an sr-only span (not just dropped to AT).
    expect(block).toHaveTextContent('Holiday')
    expect(block.querySelector('.sr-only')?.textContent).toBe('Holiday')
    // The dead pointer-events-none `title` is gone — it was unreachable, so it conveyed nothing.
    expect(block).not.toHaveAttribute('title')
  })

  it('drops the dead pointer-events-none title from the over-marker', () => {
    renderLane()
    expect(screen.getByTestId('over-marker')).not.toHaveAttribute('title')
  })

  it('renders an allocation-bar for the bar layout', () => {
    renderLane()
    expect(screen.getByTestId('allocation-bar')).toBeInTheDocument()
  })
})

describe('ResourceLane draw interaction', () => {
  it('calls onDraw with ISO date strings after pointerDown on the lane and document pointerup', () => {
    const { onDraw } = renderLane()
    const lane = screen.getByTestId('resource-lane')

    // Own the geometry explicitly (don't depend on jsdom's zero-rect default):
    // with left=0 and dayWidth=48, clientX=0 → day 0 ('2026-06-01'),
    // clientX=100 → floor(100/48)=2 → day 2 ('2026-06-03').
    lane.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 1000, bottom: 64, width: 1000, height: 64, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    fireEvent.pointerDown(lane, { clientX: 0, button: 0 })

    act(() => {
      document.dispatchEvent(new MouseEvent('pointerup', { clientX: 100, bubbles: true }))
    })

    expect(onDraw).toHaveBeenCalledTimes(1)
    const [resourceId, startDate, endDate] = onDraw.mock.calls[0]
    expect(resourceId).toBe('r1')
    expect(startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(startDate <= endDate).toBe(true)
    // Exact values given rect.left=0 and dayWidth=48
    expect(startDate).toBe('2026-06-01')
    expect(endDate).toBe('2026-06-03')
  })

  it('treats a bare click (no movement) as a single-day allocation on the clicked day', () => {
    const { onDraw } = renderLane()
    const lane = screen.getByTestId('resource-lane')
    lane.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 1000, bottom: 64, width: 1000, height: 64, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect

    // clientX=30, dayWidth=48 → day 0 ('2026-06-01'); start === end (one day).
    fireEvent.pointerDown(lane, { clientX: 30, button: 0 })
    act(() => {
      document.dispatchEvent(new MouseEvent('pointerup', { clientX: 30, bubbles: true }))
    })

    expect(onDraw).toHaveBeenCalledTimes(1)
    const [resourceId, startDate, endDate] = onDraw.mock.calls[0]
    expect(resourceId).toBe('r1')
    expect(startDate).toBe('2026-06-01')
    expect(endDate).toBe('2026-06-01')
  })

  it('does not call onDraw when pointerDown uses a non-primary button', () => {
    const { onDraw } = renderLane()
    const lane = screen.getByTestId('resource-lane')

    fireEvent.pointerDown(lane, { clientX: 0, button: 2 })

    act(() => {
      document.dispatchEvent(new MouseEvent('pointerup', { clientX: 0, bubbles: true }))
    })

    expect(onDraw).not.toHaveBeenCalled()
  })
})
