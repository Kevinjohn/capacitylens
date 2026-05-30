import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AllocationBar } from './AllocationBar'
import type { BarLayout } from './schedulerModel'
import { useStore } from '../../store/useStore'
import { type Allocation } from '../../types/entities'
import { resetStoreWithAccount } from '../../test/fixtures'

function seedAllocation(): Allocation {
  const s = useStore.getState()
  const c = s.addClient({ name: 'Acme', color: '#1' })
  const p = s.addProject({ name: 'P', clientId: c.id, color: '#2' })
  const t = s.addTask({ name: 'Wires', projectId: p.id })
  const r = s.addResource({ kind: 'person', name: 'Ty', role: 'Dev', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#3' })
  return s.addAllocation({ resourceId: r.id, taskId: t.id, startDate: '2026-06-01', endDate: '2026-06-03', hoursPerDay: 8, status: 'confirmed' })
}

const barFor = (allocation: Allocation): BarLayout => ({ allocation, x: 0, width: 144, top: 0, color: '#3b82f6', label: 'Wires' })

beforeEach(() => resetStoreWithAccount())

describe('AllocationBar interactions', () => {
  it('shows a detail popover on hover and hides it on leave', () => {
    const a = seedAllocation()
    render(<AllocationBar bar={{ ...barFor(a), project: 'Project Lightning', client: 'Acme' }} dayWidth={48} onEdit={vi.fn()} />)
    const bar = screen.getByTestId('allocation-bar')

    expect(screen.queryByTestId('allocation-popover')).toBeNull()
    fireEvent.mouseEnter(bar)
    const pop = screen.getByTestId('allocation-popover')
    expect(pop).toHaveTextContent('Project Lightning')
    expect(pop).toHaveTextContent('Acme')
    fireEvent.mouseLeave(bar)
    expect(screen.queryByTestId('allocation-popover')).toBeNull()
  })

  it('opens the editor on Enter (keyboard operable)', () => {
    const a = seedAllocation()
    const onEdit = vi.fn()
    render(<AllocationBar bar={barFor(a)} dayWidth={48} onEdit={onEdit} />)
    fireEvent.keyDown(screen.getByTestId('allocation-bar'), { key: 'Enter' })
    expect(onEdit).toHaveBeenCalled()
  })

  it('moves with arrow keys and resizes with Shift+arrow (keyboard equivalent of drag)', () => {
    const a = seedAllocation() // 2026-06-01 → 2026-06-03
    const { rerender } = render(<AllocationBar bar={barFor(a)} dayWidth={48} onEdit={vi.fn()} />)

    fireEvent.keyDown(screen.getByTestId('allocation-bar'), { key: 'ArrowRight' })
    let moved = useStore.getState().data.allocations.find((x) => x.id === a.id)!
    expect([moved.startDate, moved.endDate]).toEqual(['2026-06-02', '2026-06-04'])

    // Reflect the new dates in the bar prop (as the grid would re-render), then resize the end.
    rerender(<AllocationBar bar={barFor(moved)} dayWidth={48} onEdit={vi.fn()} />)
    fireEvent.keyDown(screen.getByTestId('allocation-bar'), { key: 'ArrowRight', shiftKey: true })
    moved = useStore.getState().data.allocations.find((x) => x.id === a.id)!
    expect([moved.startDate, moved.endDate]).toEqual(['2026-06-02', '2026-06-05']) // end extended, start fixed
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

  it('surfaces a notice (instead of failing silently) when a reassign is rejected', () => {
    const st = useStore.getState()
    const c = st.addClient({ name: 'Acme', color: '#1' })
    const p1 = st.addProject({ name: 'P1', clientId: c.id, color: '#2' })
    const p2 = st.addProject({ name: 'P2', clientId: c.id, color: '#3' })
    const t1 = st.addTask({ name: 'Wires', projectId: p1.id })
    const person = st.addResource({ kind: 'person', name: 'Ty', role: 'Dev', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#3' })
    // A placeholder bound to p2 cannot take a p1 task — dropping onto it must be rejected.
    const slot = st.addResource({ kind: 'placeholder', role: 'Slot', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#4', projectId: p2.id })
    const a = st.addAllocation({ resourceId: person.id, taskId: t1.id, startDate: '2026-06-01', endDate: '2026-06-03', hoursPerDay: 8, status: 'confirmed' })

    const rect = (top: number, bottom: number): DOMRect =>
      ({ left: 0, right: 500, top, bottom, width: 500, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect

    render(
      <>
        <div data-resource-id={person.id} data-testid="lane-src" />
        <div data-resource-id={slot.id} data-testid="lane-dst" />
        <AllocationBar bar={barFor(a)} dayWidth={48} onEdit={vi.fn()} />
      </>,
    )
    screen.getByTestId('lane-src').getBoundingClientRect = () => rect(0, 50)
    screen.getByTestId('lane-dst').getBoundingClientRect = () => rect(100, 150)

    const bar = screen.getByTestId('allocation-bar')
    fireEvent.pointerDown(bar, { clientX: 50, clientY: 25, button: 0 })
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 55, clientY: 125, bubbles: true })) // drop onto lane-dst
    document.dispatchEvent(new MouseEvent('pointerup', { clientX: 55, clientY: 125, bubbles: true }))

    // Reassign rejected -> the bar stays on its original resource AND the user is told why.
    const alloc = useStore.getState().data.allocations.find((x) => x.id === a.id)!
    expect(alloc.resourceId).toBe(person.id)
    expect(useStore.getState().notice?.message).toMatch(/placeholder/i)
  })

  it('reassigns to another row (and highlights it mid-drag) when dropped on a valid lane', () => {
    const st = useStore.getState()
    const c = st.addClient({ name: 'Acme', color: '#1' })
    const p = st.addProject({ name: 'P', clientId: c.id, color: '#2' })
    const t = st.addTask({ name: 'Wires', projectId: p.id })
    const r1 = st.addResource({ kind: 'person', name: 'Ty', role: 'Dev', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#3' })
    const r2 = st.addResource({ kind: 'person', name: 'Sam', role: 'Dev', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#4' })
    const a = st.addAllocation({ resourceId: r1.id, taskId: t.id, startDate: '2026-06-01', endDate: '2026-06-03', hoursPerDay: 8, status: 'confirmed' })

    const rect = (top: number, bottom: number): DOMRect =>
      ({ left: 0, right: 500, top, bottom, width: 500, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect

    render(
      <>
        <div data-resource-id={r1.id} data-testid="lane-src" />
        <div data-resource-id={r2.id} data-testid="lane-dst" />
        <AllocationBar bar={barFor(a)} dayWidth={48} onEdit={vi.fn()} />
      </>,
    )
    screen.getByTestId('lane-src').getBoundingClientRect = () => rect(0, 50)
    screen.getByTestId('lane-dst').getBoundingClientRect = () => rect(100, 150)

    const bar = screen.getByTestId('allocation-bar')
    fireEvent.pointerDown(bar, { clientX: 50, clientY: 25, button: 0 })
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 55, clientY: 125, bubbles: true }))
    // resourceLaneAt picks lane-dst, markDropTarget highlights exactly that lane.
    expect(screen.getByTestId('lane-dst').hasAttribute('data-droptarget')).toBe(true)
    expect(screen.getByTestId('lane-src').hasAttribute('data-droptarget')).toBe(false)
    document.dispatchEvent(new MouseEvent('pointerup', { clientX: 55, clientY: 125, bubbles: true }))

    expect(useStore.getState().data.allocations.find((x) => x.id === a.id)!.resourceId).toBe(r2.id)
    expect(screen.getByTestId('lane-dst').hasAttribute('data-droptarget')).toBe(false) // cleared on commit
  })

  it('aborts a drag on pointercancel without committing or leaking listeners', () => {
    const a = seedAllocation()
    render(<AllocationBar bar={barFor(a)} dayWidth={48} onEdit={vi.fn()} />)
    const bar = screen.getByTestId('allocation-bar')

    fireEvent.pointerDown(bar, { clientX: 50, button: 0 })
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 120, bubbles: true })) // start dragging
    document.dispatchEvent(new Event('pointercancel')) // browser steals the gesture (e.g. to scroll)

    expect(useStore.getState().data.allocations.find((x) => x.id === a.id)!.startDate).toBe('2026-06-01')

    // Listeners were torn down: a stray later pointerup must not commit a stale move.
    document.dispatchEvent(new MouseEvent('pointerup', { clientX: 300, bubbles: true }))
    expect(useStore.getState().data.allocations.find((x) => x.id === a.id)!.startDate).toBe('2026-06-01')
  })
})
