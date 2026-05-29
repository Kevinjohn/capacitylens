import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AllocationBar } from './AllocationBar'
import type { BarLayout } from './schedulerModel'
import { useStore } from '../../store/useStore'
import { emptyAppData } from '../../types/entities'
import type { Allocation } from '../../types/entities'

beforeEach(() => {
  useStore.getState().replaceAll(emptyAppData())
  useStore.getState().clearFilters()
})

function makeAllocation(overrides: Partial<Allocation> = {}): Allocation {
  return {
    id: 'alloc-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    resourceId: 'res-1',
    taskId: 'task-1',
    startDate: '2026-06-01',
    endDate: '2026-06-07',
    hoursPerDay: 8,
    status: 'confirmed',
    ...overrides,
  }
}

function makeBar(allocation: Allocation, labelOverride?: string): BarLayout {
  return {
    allocation,
    x: 0,
    width: 336,
    top: 0,
    color: '#ec4899',
    label: labelOverride ?? 'My Task',
  }
}

describe('AllocationBar rendering', () => {
  it('shows the label and hours and has data-status="confirmed"', () => {
    const allocation = makeAllocation()
    const bar = makeBar(allocation)
    const onEdit = vi.fn()

    render(<AllocationBar bar={bar} dayWidth={48} onEdit={onEdit} />)

    const el = screen.getByTestId('allocation-bar')
    expect(el).toHaveAttribute('data-status', 'confirmed')
    expect(el).toHaveTextContent('My Task')
    expect(el).toHaveTextContent('8h')
  })

  it('shows the label from the bar object', () => {
    const allocation = makeAllocation()
    const bar = makeBar(allocation, 'Sprint Planning')
    const onEdit = vi.fn()

    render(<AllocationBar bar={bar} dayWidth={48} onEdit={onEdit} />)

    const el = screen.getByTestId('allocation-bar')
    expect(el).toHaveTextContent('Sprint Planning')
  })
})

describe('AllocationBar click interaction', () => {
  it('calls onEdit when pointerDown and pointerUp occur at the same clientX (no movement)', () => {
    const allocation = makeAllocation()
    const bar = makeBar(allocation)
    const onEdit = vi.fn()

    render(<AllocationBar bar={bar} dayWidth={48} onEdit={onEdit} />)

    const el = screen.getByTestId('allocation-bar')

    // pointerDown on the bar body (not a resize handle) with button 0
    fireEvent.pointerDown(el, { clientX: 100, button: 0 })

    // pointerUp on document at the same clientX — no movement, so onClick fires
    document.dispatchEvent(new MouseEvent('pointerup', { clientX: 100, bubbles: true }))

    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('does not call onEdit when pointerDown uses a non-primary button', () => {
    const allocation = makeAllocation()
    const bar = makeBar(allocation)
    const onEdit = vi.fn()

    render(<AllocationBar bar={bar} dayWidth={48} onEdit={onEdit} />)

    const el = screen.getByTestId('allocation-bar')

    // button: 2 is right-click — the handler early-returns
    fireEvent.pointerDown(el, { clientX: 100, button: 2 })
    document.dispatchEvent(new MouseEvent('pointerup', { clientX: 100, bubbles: true }))

    expect(onEdit).not.toHaveBeenCalled()
  })
})
