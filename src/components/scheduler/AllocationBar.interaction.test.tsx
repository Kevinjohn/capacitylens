import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { AllocationBar } from './AllocationBar'
import { buildColumnGeometry } from './columnGeometry'
import type { BarLayout } from './schedulerModel'
import { eachDayISO } from '@floaty/shared/lib/dateMath'
import { useStore } from '../../store/useStore'
import { type Allocation } from '@floaty/shared/types/entities'
import { resetStoreWithAccount, DEFAULT_ACCOUNT_ID } from '../../test/fixtures'

// Uniform geometry over June at 48px/day (minimise off), origin 2026-06-01. Standalone bars are
// rendered without a lane, so the clientX→index resolver assumes the lane sits at clientX 0:
// floor(clientX / 48), exactly the old snapDeltaToDays behaviour for these single-lane drags.
const GEOM = buildColumnGeometry(eachDayISO('2026-06-01', '2026-06-30'), 48, { minimiseWeekends: false, weekendWidth: 22 })
const indexAtClientX = (clientX: number) => GEOM.indexAt(clientX)

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
    render(<AllocationBar bar={{ ...barFor(a), project: 'Project Lightning', client: 'Acme' }} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />)
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
    render(<AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={onEdit} />)
    fireEvent.keyDown(screen.getByTestId('allocation-bar'), { key: 'Enter' })
    expect(onEdit).toHaveBeenCalled()
  })

  it('moves with arrow keys and resizes with Shift+arrow (keyboard equivalent of drag)', () => {
    const a = seedAllocation() // 2026-06-01 → 2026-06-03
    const { rerender } = render(<AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />)

    fireEvent.keyDown(screen.getByTestId('allocation-bar'), { key: 'ArrowRight' })
    let moved = useStore.getState().data.allocations.find((x) => x.id === a.id)!
    expect([moved.startDate, moved.endDate]).toEqual(['2026-06-02', '2026-06-04'])

    // Reflect the new dates in the bar prop (as the grid would re-render), then resize the end.
    rerender(<AllocationBar bar={barFor(moved)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />)
    fireEvent.keyDown(screen.getByTestId('allocation-bar'), { key: 'ArrowRight', shiftKey: true })
    moved = useStore.getState().data.allocations.find((x) => x.id === a.id)!
    expect([moved.startDate, moved.endDate]).toEqual(['2026-06-02', '2026-06-05']) // end extended, start fixed
  })

  it('commits a move drag to the store (shifts both dates by a day)', () => {
    const a = seedAllocation()
    render(<AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />)
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
    render(<AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={onEdit} />)
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
        <AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />
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
        <AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />
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

  describe('days mode preserves volume on resize', () => {
    const enableDays = () => useStore.getState().updateAccount(DEFAULT_ACCOUNT_ID, { schedulingMode: 'days' })

    it('rescales hours/day when the end is resized by keyboard (Shift+arrow)', () => {
      enableDays()
      const a = seedAllocation() // 2026-06-01 → 2026-06-03, 8h/day, Mon–Fri = 3 working days
      render(<AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />)

      fireEvent.keyDown(screen.getByTestId('allocation-bar'), { key: 'ArrowRight', shiftKey: true })
      const after = useStore.getState().data.allocations.find((x) => x.id === a.id)!
      // Span grows 3 → 4 working days; the 24h of work (8×3) now spreads over 4 → 6h/day.
      expect(after.endDate).toBe('2026-06-04')
      expect(after.hoursPerDay).toBe(6)
    })

    it('leaves hours/day untouched on a move (span unchanged)', () => {
      enableDays()
      const a = seedAllocation()
      render(<AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />)

      fireEvent.keyDown(screen.getByTestId('allocation-bar'), { key: 'ArrowRight' })
      const after = useStore.getState().data.allocations.find((x) => x.id === a.id)!
      expect(after.hoursPerDay).toBe(8)
    })

    it('rescales hours/day when the end grip is dragged', () => {
      enableDays()
      const a = seedAllocation()
      render(<AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />)

      fireEvent.pointerDown(screen.getByTestId('resize-end'), { clientX: 144, button: 0 })
      document.dispatchEvent(new MouseEvent('pointermove', { clientX: 192, bubbles: true })) // +48px ≈ +1 day
      document.dispatchEvent(new MouseEvent('pointerup', { clientX: 192, bubbles: true }))

      const after = useStore.getState().data.allocations.find((x) => x.id === a.id)!
      expect(after.endDate).toBe('2026-06-04')
      expect(after.hoursPerDay).toBe(6)
    })

    it('hourly mode keeps hours/day fixed on resize (regression guard)', () => {
      // No enableDays() — the default account is hourly.
      const a = seedAllocation()
      render(<AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />)

      fireEvent.keyDown(screen.getByTestId('allocation-bar'), { key: 'ArrowRight', shiftKey: true })
      const after = useStore.getState().data.allocations.find((x) => x.id === a.id)!
      expect(after.endDate).toBe('2026-06-04')
      expect(after.hoursPerDay).toBe(8)
    })
  })

  it('pins the dragged row (draggingAllocationId) on the first move and clears it on commit', () => {
    const a = seedAllocation()
    render(<AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />)
    const bar = screen.getByTestId('allocation-bar')
    expect(useStore.getState().draggingAllocationId).toBeNull()

    fireEvent.pointerDown(bar, { clientX: 50, button: 0 })
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 98, bubbles: true })) // first move → pin
    expect(useStore.getState().draggingAllocationId).toBe(a.id)

    document.dispatchEvent(new MouseEvent('pointerup', { clientX: 98, bubbles: true })) // commit → release
    expect(useStore.getState().draggingAllocationId).toBeNull()
  })

  it('clears the drag-pin on pointercancel, and on unmount if the bar still owns it', () => {
    const a = seedAllocation()
    const { unmount } = render(<AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />)
    fireEvent.pointerDown(screen.getByTestId('allocation-bar'), { clientX: 50, button: 0 })
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 120, bubbles: true }))
    expect(useStore.getState().draggingAllocationId).toBe(a.id)
    document.dispatchEvent(new Event('pointercancel'))
    expect(useStore.getState().draggingAllocationId).toBeNull()

    // And the unmount-cleanup releases a pin this bar still owns (deleted/account-switch mid-drag).
    fireEvent.pointerDown(screen.getByTestId('allocation-bar'), { clientX: 50, button: 0 })
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 120, bubbles: true }))
    expect(useStore.getState().draggingAllocationId).toBe(a.id)
    unmount()
    expect(useStore.getState().draggingAllocationId).toBeNull()
  })

  it('a cross-row reassign computes dates against the TARGET resource’s working week, not the source’s', () => {
    const st = useStore.getState()
    const c = st.addClient({ name: 'Acme', color: '#1' })
    const p = st.addProject({ name: 'P', clientId: c.id, color: '#2' })
    const t = st.addTask({ name: 'Wires', projectId: p.id })
    // Source works EVERY day (not weekend-aware); target works Mon–Fri (weekend-aware).
    const src = st.addResource({ kind: 'person', name: 'Sev', role: 'Dev', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [0, 1, 2, 3, 4, 5, 6], color: '#3' })
    const dst = st.addResource({ kind: 'person', name: 'Wk', role: 'Dev', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#4' })
    // A single-day allocation on Friday 2026-06-05, on the source resource.
    const a = st.addAllocation({ resourceId: src.id, taskId: t.id, startDate: '2026-06-05', endDate: '2026-06-05', hoursPerDay: 8, status: 'confirmed' })

    const rect = (top: number, bottom: number): DOMRect =>
      ({ left: 0, right: 500, top, bottom, width: 500, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect
    render(
      <>
        <div data-resource-id={src.id} data-testid="lane-src" />
        <div data-resource-id={dst.id} data-testid="lane-dst" />
        <AllocationBar bar={{ allocation: a, x: 0, width: 48, top: 0, color: '#3b82f6', label: 'Wires' }} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />
      </>,
    )
    screen.getByTestId('lane-src').getBoundingClientRect = () => rect(0, 50)
    screen.getByTestId('lane-dst').getBoundingClientRect = () => rect(100, 150)

    const bar = screen.getByTestId('allocation-bar')
    fireEvent.pointerDown(bar, { clientX: 24, clientY: 25, button: 0 })
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 72, clientY: 125, bubbles: true })) // +1 day, drop on dst
    document.dispatchEvent(new MouseEvent('pointerup', { clientX: 72, clientY: 125, bubbles: true }))

    const moved = useStore.getState().data.allocations.find((x) => x.id === a.id)!
    expect(moved.resourceId).toBe(dst.id)
    // Start shifts +1 → Sat 06-06. Under the TARGET's Mon–Fri week the 1 working day extends
    // the end to Mon 06-08 (was 06-06 if computed against the source's 7-day week).
    expect([moved.startDate, moved.endDate]).toEqual(['2026-06-06', '2026-06-08'])
  })

  it('previews the SAME weekend-snapped geometry the commit applies (no jump on release)', () => {
    const st = useStore.getState()
    const c = st.addClient({ name: 'Acme', color: '#1' })
    const p = st.addProject({ name: 'P', clientId: c.id, color: '#2' })
    const t = st.addTask({ name: 'Wires', projectId: p.id })
    const r = st.addResource({ kind: 'person', name: 'Ty', role: 'Dev', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#3' })
    // Mon–Fri allocation 06-01..06-05 (5 working days) → a 5-calendar-day-wide bar.
    const a = st.addAllocation({ resourceId: r.id, taskId: t.id, startDate: '2026-06-01', endDate: '2026-06-05', hoursPerDay: 8, status: 'confirmed' })
    const dayWidth = 48
    render(<AllocationBar bar={{ allocation: a, x: 0, width: 5 * dayWidth, top: 0, color: '#3b82f6', label: 'Wires' }} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />)
    const bar = screen.getByTestId('allocation-bar')

    fireEvent.pointerDown(bar, { clientX: 10, clientY: 10, button: 0 })
    // Move +1 day — crosses the weekend, so the commit extends the end (Fri → following Mon).
    act(() => {
      document.dispatchEvent(new MouseEvent('pointermove', { clientX: 10 + dayWidth, clientY: 10, bubbles: true }))
    })
    // The PREVIEW width reflects the extended 7-day span (06-02..06-08), not the raw 5-day
    // bar — matching what the commit produces, so the bar doesn't jump on release.
    const previewedWidth = parseFloat((bar as HTMLElement).style.width)
    expect(previewedWidth).toBeGreaterThan(6 * dayWidth - 12) // ~7 days (minus inset), not 5
  })

  it('aborts a drag on pointercancel without committing or leaking listeners', () => {
    const a = seedAllocation()
    render(<AllocationBar bar={barFor(a)} geom={GEOM} indexAtClientX={indexAtClientX} onEdit={vi.fn()} />)
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
