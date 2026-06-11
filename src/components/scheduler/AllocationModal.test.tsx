import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AllocationModal } from './AllocationModal'
import { useStore } from '../../store/useStore'
import type { AppData } from '@floaty/shared/types/entities'
import { DEFAULT_ACCOUNT_ID, makeAppData } from '../../test/fixtures'

const ACC = DEFAULT_ACCOUNT_ID

function base(): AppData {
  return makeAppData({
    clients: [{ id: 'c1', accountId: ACC, createdAt: 't', updatedAt: 't', name: 'Acme', color: '#111' }],
    projects: [
      { id: 'p1', accountId: ACC, createdAt: 't', updatedAt: 't', name: 'Lightning', clientId: 'c1', color: '#ec4899' },
      { id: 'p2', accountId: ACC, createdAt: 't', updatedAt: 't', name: 'Other', clientId: 'c1', color: '#06b6d4' },
    ],
    tasks: [
      { id: 't1', accountId: ACC, createdAt: 't', updatedAt: 't', name: 'Wireframes', projectId: 'p1' },
      { id: 't2', accountId: ACC, createdAt: 't', updatedAt: 't', name: 'Other task', projectId: 'p2' },
    ],
  })
}

beforeEach(() => {
  useStore.getState().replaceAll(base())
  useStore.getState().setActiveAccount(ACC)
})

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
    fireEvent.change(screen.getByLabelText('Start Date'), { target: { value: '' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/start and end dates are required/i)
    expect(useStore.getState().data.allocations).toHaveLength(0)

    // Zero hours is rejected too (would silently occupy a lane with no load).
    fireEvent.change(screen.getByLabelText('Start Date'), { target: { value: '2026-06-01' } })
    fireEvent.change(screen.getByLabelText('Hours / day'), { target: { value: '0' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/greater than 0/i)
    expect(useStore.getState().data.allocations).toHaveLength(0)
  })

  it('restricts a placeholder to its bound project (plus general), defaulting to it', async () => {
    const ph = useStore.getState().addResource({
      kind: 'placeholder', role: 'Senior Designer', employmentType: 'permanent',
      workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#a855f7', projectId: 'p1',
    })
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<AllocationModal create={{ resourceId: ph.id, startDate: '2026-06-01', endDate: '2026-06-02' }} onClose={onClose} />)

    const projectSelect = screen.getByLabelText('Project')
    expect(projectSelect).toHaveValue('p1')
    // Bound project + general are offered; another project (p2 / "Other") is not.
    expect(screen.getByRole('option', { name: 'No project (general)' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Acme / Other' })).not.toBeInTheDocument()

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

describe('AllocationModal days mode', () => {
  const enableDays = () => useStore.getState().updateAccount(ACC, { schedulingMode: 'days' })

  it('derives end date + hours/day from start, days of work and days over', async () => {
    enableDays()
    const r = useStore.getState().addResource({ ...person('Tyler'), workingDays: [1, 2, 3, 4, 5] })
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<AllocationModal create={{ resourceId: r.id, startDate: '2026-06-01', endDate: '2026-06-01' }} onClose={onClose} />)

    // Days mode swaps the End / Hours-per-day fields for Days of work / Days over.
    expect(screen.queryByLabelText('End')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Hours / day')).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Project'), 'p1')
    await user.selectOptions(screen.getByLabelText('Task'), 't1')
    fireEvent.change(screen.getByLabelText('Days of work'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('Days over'), { target: { value: '10' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onClose).toHaveBeenCalled()
    // 10 working days from Mon 2026-06-01 (Mon–Fri) lands on Fri 2026-06-12;
    // 5 days of work spread over 10 at an 8h day = 4h/day.
    expect(useStore.getState().data.allocations[0]).toMatchObject({
      startDate: '2026-06-01',
      endDate: '2026-06-12',
      hoursPerDay: 4,
    })
  })

  it('rejects zero days of work', async () => {
    enableDays()
    const r = useStore.getState().addResource({ ...person('Tyler'), workingDays: [1, 2, 3, 4, 5] })
    const user = userEvent.setup()
    render(<AllocationModal create={{ resourceId: r.id, startDate: '2026-06-01', endDate: '2026-06-01' }} onClose={vi.fn()} />)

    await user.selectOptions(screen.getByLabelText('Project'), 'p1')
    await user.selectOptions(screen.getByLabelText('Task'), 't1')
    fireEvent.change(screen.getByLabelText('Days of work'), { target: { value: '0' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/days of work must be greater than 0/i)
    expect(useStore.getState().data.allocations).toHaveLength(0)
  })

  it('honours the drawn span when creating (days over = the dragged-out length)', async () => {
    enableDays()
    const r = useStore.getState().addResource({ ...person('Tyler'), workingDays: [1, 2, 3, 4, 5] })
    const user = userEvent.setup()
    // The grid hands the modal a 5-working-day span (Mon 06-01 … Fri 06-05).
    render(<AllocationModal create={{ resourceId: r.id, startDate: '2026-06-01', endDate: '2026-06-05' }} onClose={vi.fn()} />)

    expect(screen.getByLabelText('Days over')).toHaveValue(5)
    expect(screen.getByLabelText('Days of work')).toHaveValue(5) // full-time across the span

    await user.selectOptions(screen.getByLabelText('Project'), 'p1')
    await user.selectOptions(screen.getByLabelText('Task'), 't1')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(useStore.getState().data.allocations[0]).toMatchObject({ startDate: '2026-06-01', endDate: '2026-06-05', hoursPerDay: 8 })
  })

  it('does not drift hours when an unevenly-dividing allocation is re-saved unchanged', async () => {
    enableDays()
    const r = useStore.getState().addResource({ ...person('Tyler'), workingDays: [1, 2, 3, 4, 5] })
    // 5h/day over 3 working days = 1.875 days of work — a value 2-dp rounding would distort.
    const alloc = useStore.getState().addAllocation({ resourceId: r.id, taskId: 't1', startDate: '2026-06-01', endDate: '2026-06-03', hoursPerDay: 5, status: 'confirmed' })
    const user = userEvent.setup()
    render(<AllocationModal allocationId={alloc.id} onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Save' }))
    const after = useStore.getState().data.allocations.find((a) => a.id === alloc.id)!
    expect(after.endDate).toBe('2026-06-03')
    expect(after.hoursPerDay).toBeCloseTo(5, 6)
  })

  it('seeds the days inputs by inverting an existing allocation', () => {
    enableDays()
    const r = useStore.getState().addResource({ ...person('Tyler'), workingDays: [1, 2, 3, 4, 5] })
    // 4h/day over 2026-06-01..06-12 (10 working days) = 5 days of work.
    const alloc = useStore.getState().addAllocation({ resourceId: r.id, taskId: 't1', startDate: '2026-06-01', endDate: '2026-06-12', hoursPerDay: 4, status: 'confirmed' })
    render(<AllocationModal allocationId={alloc.id} onClose={vi.fn()} />)

    expect(screen.getByLabelText('Days of work')).toHaveValue(5)
    expect(screen.getByLabelText('Days over')).toHaveValue(10)
  })
})

describe('AllocationModal blocks mode', () => {
  const enableBlocks = () => useStore.getState().updateAccount(ACC, { schedulingMode: 'blocks' })

  it('asks only for start + days over, and persists a zero-load span', async () => {
    enableBlocks()
    const r = useStore.getState().addResource({ ...person('Tyler'), workingDays: [1, 2, 3, 4, 5] })
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<AllocationModal create={{ resourceId: r.id, startDate: '2026-06-01', endDate: '2026-06-01' }} onClose={onClose} />)

    // Blocks drops every load field — no End, no Hours/day, no Days of work.
    expect(screen.queryByLabelText('End')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Hours / day')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Days of work')).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Project'), 'p1')
    await user.selectOptions(screen.getByLabelText('Task'), 't1')
    fireEvent.change(screen.getByLabelText('Days over'), { target: { value: '10' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onClose).toHaveBeenCalled()
    // 10 working days from Mon 2026-06-01 lands on Fri 2026-06-12; load is 0.
    expect(useStore.getState().data.allocations[0]).toMatchObject({
      startDate: '2026-06-01',
      endDate: '2026-06-12',
      hoursPerDay: 0,
    })
  })

  it('seeds days over from the drawn span and saves with start alone', async () => {
    enableBlocks()
    const r = useStore.getState().addResource({ ...person('Tyler'), workingDays: [1, 2, 3, 4, 5] })
    const user = userEvent.setup()
    // Grid hands a 5-working-day span (Mon 06-01 … Fri 06-05).
    render(<AllocationModal create={{ resourceId: r.id, startDate: '2026-06-01', endDate: '2026-06-05' }} onClose={vi.fn()} />)

    expect(screen.getByLabelText('Days over')).toHaveValue(5)

    await user.selectOptions(screen.getByLabelText('Project'), 'p1')
    await user.selectOptions(screen.getByLabelText('Task'), 't1')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(useStore.getState().data.allocations[0]).toMatchObject({ startDate: '2026-06-01', endDate: '2026-06-05', hoursPerDay: 0 })
  })
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

  it('snaps the project to the placeholder bound project when reassigned, restricting options', async () => {
    const a = useStore.getState().addResource({ ...person('Alice'), workingDays: [1, 2, 3, 4, 5] })
    const ph = useStore.getState().addResource({
      kind: 'placeholder', role: 'Designer', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#a', projectId: 'p2',
    })
    const alloc = useStore.getState().addAllocation({ resourceId: a.id, taskId: 't1', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' })
    const user = userEvent.setup()
    render(<AllocationModal allocationId={alloc.id} onClose={vi.fn()} />)

    await user.selectOptions(screen.getByLabelText('Assignee'), ph.id)
    expect(screen.getByLabelText('Project')).toHaveValue('p2')
    // The non-bound project (p1 / "Lightning") is no longer offered to the placeholder.
    expect(screen.queryByRole('option', { name: 'Acme / Lightning' })).not.toBeInTheDocument()
  })

  it('reopens a placeholder→general-task allocation with the general task still selected', async () => {
    // A placeholder bound to p1, assigned a GENERAL (no-project) task. On edit the
    // form must seed Project='' (general) so the general task stays in the Task list.
    const ph = useStore.getState().addResource({
      kind: 'placeholder', role: 'Designer', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#a', projectId: 'p1',
    })
    const gen = useStore.getState().addTask({ name: 'Admin' })
    const alloc = useStore.getState().addAllocation({ resourceId: ph.id, taskId: gen.id, startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' })
    render(<AllocationModal allocationId={alloc.id} onClose={vi.fn()} />)

    expect(screen.getByLabelText('Project')).toHaveValue('') // general, not the bound 'p1'
    expect(screen.getByLabelText('Task')).toHaveValue(gen.id)
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

describe('AllocationModal Enter key submission', () => {
  it('submits when Enter is pressed in the Hours/day input (hourly mode)', async () => {
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

    // Pressing Enter in the Hours/day number input should submit
    await user.click(screen.getByLabelText('Hours / day'))
    await user.keyboard('{Enter}')

    expect(onClose).toHaveBeenCalled()
    expect(useStore.getState().data.allocations).toHaveLength(1)
  })

  it('does NOT submit when Enter is pressed in the Note textarea', async () => {
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

    // Pressing Enter in a textarea inserts a newline — it must NOT submit the form
    const noteTextarea = screen.getByLabelText('Note')
    await user.click(noteTextarea)
    await user.keyboard('{Enter}')

    expect(onClose).not.toHaveBeenCalled()
    expect(useStore.getState().data.allocations).toHaveLength(0)
    // The textarea should now contain a newline
    expect(noteTextarea).toHaveValue('\n')
  })

  it('pressing Enter in the new-task input calls onAddTask, not submit', async () => {
    useStore.getState().addResource({
      kind: 'person', name: 'Tyler', role: 'Designer', employmentType: 'permanent',
      workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#111',
    })
    const resourceId = useStore.getState().data.resources[0].id
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<AllocationModal create={{ resourceId, startDate: '2026-06-01', endDate: '2026-06-03' }} onClose={onClose} />)

    // Type a task name into the inline "add new task" input and press Enter
    await user.click(screen.getByLabelText('New task name'))
    await user.type(screen.getByLabelText('New task name'), 'Brand new task')
    await user.keyboard('{Enter}')

    // The task should have been created, modal not closed
    expect(onClose).not.toHaveBeenCalled()
    const tasks = useStore.getState().data.tasks
    expect(tasks.some((t) => t.name === 'Brand new task')).toBe(true)
  })
})
