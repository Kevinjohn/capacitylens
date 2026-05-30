import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AllocationModal } from './AllocationModal'
import { useStore } from '../../store/useStore'
import { emptyAppData } from '../../types/entities'
import type { AppData } from '../../types/entities'

function base(): AppData {
  return {
    ...emptyAppData(),
    clients: [{ id: 'c1', createdAt: 't', updatedAt: 't', name: 'Acme', color: '#111' }],
    projects: [
      { id: 'p1', createdAt: 't', updatedAt: 't', name: 'Lightning', clientId: 'c1', color: '#ec4899' },
      { id: 'p2', createdAt: 't', updatedAt: 't', name: 'Other', clientId: 'c1', color: '#06b6d4' },
    ],
    tasks: [
      { id: 't1', createdAt: 't', updatedAt: 't', name: 'Wireframes', projectId: 'p1' },
      { id: 't2', createdAt: 't', updatedAt: 't', name: 'Other task', projectId: 'p2' },
    ],
  }
}

beforeEach(() => useStore.getState().replaceAll(base()))

describe('AllocationModal create', () => {
  it('creates an allocation for a person after picking project + task', async () => {
    useStore.getState().addResource({
      kind: 'person', name: 'Tyler', role: 'Designer', employmentType: 'permanent',
      workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#111',
    })
    const resourceId = useStore.getState().data.resources[0].id
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<AllocationModal create={{ resourceId, startDate: '2026-06-01', endDate: '2026-06-03' }} onClose={onClose} />)

    await user.selectOptions(screen.getByLabelText('Project'), 'p1')
    await user.selectOptions(screen.getByLabelText('Task'), 't1')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onClose).toHaveBeenCalled()
    const allocs = useStore.getState().data.allocations
    expect(allocs).toHaveLength(1)
    expect(allocs[0]).toMatchObject({ resourceId, taskId: 't1', startDate: '2026-06-01', endDate: '2026-06-03' })
  })

  it('rejects an empty date or zero hours instead of saving a broken allocation', async () => {
    useStore.getState().addResource({
      kind: 'person', name: 'Tyler', role: 'Designer', employmentType: 'permanent',
      workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#111',
    })
    const resourceId = useStore.getState().data.resources[0].id
    const user = userEvent.setup()
    render(<AllocationModal create={{ resourceId, startDate: '2026-06-01', endDate: '2026-06-03' }} onClose={vi.fn()} />)

    await user.selectOptions(screen.getByLabelText('Project'), 'p1')
    await user.selectOptions(screen.getByLabelText('Task'), 't1')

    // Clearing a date must NOT produce a NaN-geometry allocation.
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/start and end dates are required/i)
    expect(useStore.getState().data.allocations).toHaveLength(0)

    // Zero hours is rejected too (would silently occupy a lane with no load).
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2026-06-01' } })
    fireEvent.change(screen.getByLabelText('Hours / day'), { target: { value: '0' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/greater than 0/i)
    expect(useStore.getState().data.allocations).toHaveLength(0)
  })

  it('locks a placeholder to its bound project', async () => {
    const ph = useStore.getState().addResource({
      kind: 'placeholder', role: 'Senior Designer', employmentType: 'permanent',
      workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#a855f7', projectId: 'p1',
    })
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<AllocationModal create={{ resourceId: ph.id, startDate: '2026-06-01', endDate: '2026-06-02' }} onClose={onClose} />)

    const projectSelect = screen.getByLabelText('Project')
    expect(projectSelect).toBeDisabled()
    expect(projectSelect).toHaveValue('p1')

    // Only the bound project's task is offered.
    await user.selectOptions(screen.getByLabelText('Task'), 't1')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onClose).toHaveBeenCalled()
    expect(useStore.getState().data.allocations[0]).toMatchObject({ resourceId: ph.id, taskId: 't1' })
  })
})

const person = (name: string) => ({
  kind: 'person' as const,
  name,
  role: 'Dev',
  employmentType: 'permanent' as const,
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5] as const,
  color: '#111',
})

describe('AllocationModal edit', () => {
  it('reassigns an allocation to another resource', async () => {
    const a = useStore.getState().addResource({ ...person('Alice'), workingDays: [1, 2, 3, 4, 5] })
    const b = useStore.getState().addResource({ ...person('Bob'), workingDays: [1, 2, 3, 4, 5] })
    const alloc = useStore.getState().addAllocation({ resourceId: a.id, taskId: 't1', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' })
    const user = userEvent.setup()
    render(<AllocationModal allocationId={alloc.id} onClose={vi.fn()} />)

    await user.selectOptions(screen.getByLabelText('Assignee'), b.id)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(useStore.getState().data.allocations.find((x) => x.id === alloc.id)!.resourceId).toBe(b.id)
  })

  it('locks the project when reassigned to a placeholder', async () => {
    const a = useStore.getState().addResource({ ...person('Alice'), workingDays: [1, 2, 3, 4, 5] })
    const ph = useStore.getState().addResource({
      kind: 'placeholder', role: 'Designer', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#a', projectId: 'p2',
    })
    const alloc = useStore.getState().addAllocation({ resourceId: a.id, taskId: 't1', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' })
    const user = userEvent.setup()
    render(<AllocationModal allocationId={alloc.id} onClose={vi.fn()} />)

    await user.selectOptions(screen.getByLabelText('Assignee'), ph.id)
    expect(screen.getByLabelText('Project')).toBeDisabled()
    expect(screen.getByLabelText('Project')).toHaveValue('p2')
  })

  it('duplicates an allocation', async () => {
    const a = useStore.getState().addResource({ ...person('Alice'), workingDays: [1, 2, 3, 4, 5] })
    const alloc = useStore.getState().addAllocation({ resourceId: a.id, taskId: 't1', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' })
    const user = userEvent.setup()
    render(<AllocationModal allocationId={alloc.id} onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Duplicate' }))
    expect(useStore.getState().data.allocations).toHaveLength(2)
  })
})
