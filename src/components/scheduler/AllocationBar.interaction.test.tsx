import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AllocationBar, type BarLayout } from './AllocationBar'
import { useStore } from '../../store/useStore'
import { emptyAppData, type Allocation } from '../../types/entities'

function seedAllocation(): Allocation {
  const s = useStore.getState()
  const c = s.addClient({ name: 'Acme', color: '#1' })
  const p = s.addProject({ name: 'P', clientId: c.id, color: '#2' })
  const t = s.addTask({ name: 'Wires', projectId: p.id })
  const r = s.addResource({ kind: 'person', name: 'Ty', role: 'Dev', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#3' })
  return s.addAllocation({ resourceId: r.id, taskId: t.id, startDate: '2026-06-01', endDate: '2026-06-03', hoursPerDay: 8, status: 'confirmed' })
}

const barFor = (allocation: Allocation): BarLayout => ({ allocation, x: 0, width: 144, top: 0, color: '#3b82f6', label: 'Wires' })

beforeEach(() => useStore.getState().replaceAll(emptyAppData()))

describe('AllocationBar interactions', () => {
  it('opens the editor on Enter (keyboard operable)', () => {
    const a = seedAllocation()
    const onEdit = vi.fn()
    render(<AllocationBar bar={barFor(a)} dayWidth={48} onEdit={onEdit} />)
    fireEvent.keyDown(screen.getByTestId('allocation-bar'), { key: 'Enter' })
    expect(onEdit).toHaveBeenCalled()
  })

  it('commits a move drag to the store (shifts both dates by a day)', () => {
    const a = seedAllocation()
    render(<AllocationBar bar={barFor(a)} dayWidth={48} onEdit={vi.fn()} />)
    const bar = screen.getByTestId('allocation-bar')

    fireEvent.pointerDown(bar, { clientX: 50, button: 0 })
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 98, bubbles: true })) // +48px ≈ +1 day
    document.dispatchEvent(new MouseEvent('pointerup', { clientX: 98, bubbles: true }))

    const moved = useStore.getState().data.allocations.find((x) => x.id === a.id)!
    expect(moved.startDate).toBe('2026-06-02')
    expect(moved.endDate).toBe('2026-06-04')
  })

  it('a click (no movement) opens the editor instead of moving', () => {
    const a = seedAllocation()
    const onEdit = vi.fn()
    render(<AllocationBar bar={barFor(a)} dayWidth={48} onEdit={onEdit} />)
    const bar = screen.getByTestId('allocation-bar')

    fireEvent.pointerDown(bar, { clientX: 50, button: 0 })
    document.dispatchEvent(new MouseEvent('pointerup', { clientX: 50, bubbles: true }))

    expect(onEdit).toHaveBeenCalled()
    const unchanged = useStore.getState().data.allocations.find((x) => x.id === a.id)!
    expect(unchanged.startDate).toBe('2026-06-01')
  })
})
