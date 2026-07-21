import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AllocationModal } from './AllocationModal'
import { useStore } from '../../store/useStore'
import type { AppData } from '@capacitylens/shared/types/entities'
import { DEFAULT_ACCOUNT_ID, makeAppData, setExternalEnabled, setPlaceholdersEnabled } from '../../test/fixtures'

const ACC = DEFAULT_ACCOUNT_ID

async function chooseOption(
  _user: ReturnType<typeof userEvent.setup>,
  label: string,
  optionName: string,
) {
  const trigger = screen.getByRole('combobox', { name: label })
  trigger.focus()
  fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  fireEvent.click(screen.getByRole('option', { name: optionName }))
}

function base(): AppData {
  return makeAppData({
    clients: [{ id: 'c1', accountId: ACC, createdAt: 't', updatedAt: 't', name: 'Acme', color: '#111' }],
    projects: [
      { id: 'p1', accountId: ACC, createdAt: 't', updatedAt: 't', name: 'Lightning', clientId: 'c1', color: '#ec4899' },
      { id: 'p2', accountId: ACC, createdAt: 't', updatedAt: 't', name: 'Other', clientId: 'c1', color: '#06b6d4' },
    ],
    activities: [
      { id: 't1', accountId: ACC, createdAt: 't', updatedAt: 't', name: 'Wireframes', kind: 'project', projectId: 'p1' },
      { id: 't2', accountId: ACC, createdAt: 't', updatedAt: 't', name: 'Other activity', kind: 'project', projectId: 'p2' },
    ],
  })
}

beforeEach(() => {
  useStore.getState().replaceAll(base())
  useStore.getState().setActiveAccount(ACC)
  // Placeholders default OFF (per-account pref). Several tests reassign to / from a placeholder
  // via the Assignee picker, which only offers placeholders when the pref is on — enable it for
  // the suite. The risk-A case (editing an allocation already ON a placeholder while the pref is
  // OFF still shows that placeholder) has its own dedicated test below.
  setPlaceholdersEnabled(true)
})

describe('AllocationModal create', () => {
  it('creates an allocation for a person after picking project + activity', async () => {
    useStore.getState().addResource({
      kind: 'person', name: 'Tyler', role: 'Designer', employmentType: 'permanent',
      workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#111',
    })
    const resourceId = useStore.getState().data.resources[0].id
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<AllocationModal create={{ resourceId, startDate: '2026-06-01', endDate: '2026-06-03' }} onClose={onClose} />)

    await chooseOption(user, 'Project', 'Acme / Lightning')
    await chooseOption(user, 'Activity', 'Wireframes')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onClose).toHaveBeenCalled()
    const allocs = useStore.getState().data.allocations
    expect(allocs).toHaveLength(1)
    expect(allocs[0]).toMatchObject({ resourceId, activityId: 't1', startDate: '2026-06-01', endDate: '2026-06-03' })
  })

  it('rejects an empty date or zero hours instead of saving a broken allocation', async () => {
    useStore.getState().addResource({
      kind: 'person', name: 'Tyler', role: 'Designer', employmentType: 'permanent',
      workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#111',
    })
    const resourceId = useStore.getState().data.resources[0].id
    const user = userEvent.setup()
    render(<AllocationModal create={{ resourceId, startDate: '2026-06-01', endDate: '2026-06-03' }} onClose={vi.fn()} />)

    await chooseOption(user, 'Project', 'Acme / Lightning')
    await chooseOption(user, 'Activity', 'Wireframes')

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

  it('rejects hours/day above the 24h cap submitted via Enter (no silent clamp)', async () => {
    // The field caps at MAX_HOURS_PER_DAY on blur, but an Enter-submit without a blur can still
    // carry a larger value the store would quietly clamp. The submit-path guard must reject it.
    useStore.getState().addResource({
      kind: 'person', name: 'Tyler', role: 'Designer', employmentType: 'permanent',
      workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#111',
    })
    const resourceId = useStore.getState().data.resources[0].id
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<AllocationModal create={{ resourceId, startDate: '2026-06-01', endDate: '2026-06-03' }} onClose={onClose} />)

    await chooseOption(user, 'Project', 'Acme / Lightning')
    await chooseOption(user, 'Activity', 'Wireframes')
    const hours = screen.getByLabelText('Hours / day')
    fireEvent.change(hours, { target: { value: '40' } })
    fireEvent.submit(hours.closest('form')!) // Enter-submit, no blur clamp

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/can’t exceed 24/i)
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

    const projectSelect = screen.getByRole('combobox', { name: 'Project' })
    expect(projectSelect).toHaveTextContent('Acme / Lightning')
    // Bound project + the project-less option are offered; another project (p2 / "Other") is not.
    fireEvent.keyDown(projectSelect, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: 'No project (internal / cross-project)' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Acme / Other' })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')

    // Only the bound project's activity is offered.
    await chooseOption(user, 'Activity', 'Wireframes')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onClose).toHaveBeenCalled()
    expect(useStore.getState().data.allocations[0]).toMatchObject({ resourceId: ph.id, activityId: 't1' })
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

    await chooseOption(user, 'Project', 'Acme / Lightning')
    await chooseOption(user, 'Activity', 'Wireframes')
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

    await chooseOption(user, 'Project', 'Acme / Lightning')
    await chooseOption(user, 'Activity', 'Wireframes')
    fireEvent.change(screen.getByLabelText('Days of work'), { target: { value: '0' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/days of work must be greater than 0/i)
    expect(useStore.getState().data.allocations).toHaveLength(0)
  })

  it('rejects a work volume that would derive more than 24h/day (no silent clamp)', async () => {
    // 5 days of work crammed into a 1-day span = 40h/day, which the store would clamp to 24 —
    // silently discarding the entered volume. The modal must reject so preview === saved.
    enableDays()
    const r = useStore.getState().addResource({ ...person('Tyler'), workingDays: [1, 2, 3, 4, 5] })
    const user = userEvent.setup()
    render(<AllocationModal create={{ resourceId: r.id, startDate: '2026-06-01', endDate: '2026-06-01' }} onClose={vi.fn()} />)

    await chooseOption(user, 'Project', 'Acme / Lightning')
    await chooseOption(user, 'Activity', 'Wireframes')
    fireEvent.change(screen.getByLabelText('Days of work'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('Days over'), { target: { value: '1' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/more than 24h a day/i)
    expect(useStore.getState().data.allocations).toHaveLength(0)
  })

  it('rejects an EMPTY "Days over" submitted via Enter (no blur) instead of saving a 0-hour allocation', async () => {
    // The NaN hole: a valid "Days of work" but a "Days over" left empty/part-typed emits NaN
    // (NumberField only clamps to min on blur). hoursPerDayFor(daysOfWork, NaN, whpd) is NaN, the
    // store's clampHoursPerDay(NaN) → 0, so a SILENT 0-hour allocation would save. Submitting via
    // Enter directly from the field skips the blur-clamp, exercising exactly that path. The load
    // guard must reject (NaN fails Number.isFinite) and persist nothing.
    enableDays()
    const r = useStore.getState().addResource({ ...person('Tyler'), workingDays: [1, 2, 3, 4, 5] })
    const onClose = vi.fn()
    const addAllocation = vi.spyOn(useStore.getState(), 'addAllocation')
    const user = userEvent.setup()
    render(<AllocationModal create={{ resourceId: r.id, startDate: '2026-06-01', endDate: '2026-06-01' }} onClose={onClose} />)

    await chooseOption(user, 'Project', 'Acme / Lightning')
    await chooseOption(user, 'Activity', 'Wireframes')
    fireEvent.change(screen.getByLabelText('Days of work'), { target: { value: '5' } })
    // Empty the "Days over" field — emits NaN — then submit the form directly (Enter from a
    // single number input), which skips the field's on-blur clamp.
    const daysOver = screen.getByLabelText('Days over')
    fireEvent.change(daysOver, { target: { value: '' } })
    fireEvent.submit(daysOver.closest('form')!)

    expect(onClose).not.toHaveBeenCalled()
    expect(addAllocation).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/days over must be a whole number from 1/i)
    expect(useStore.getState().data.allocations).toHaveLength(0)
    addAllocation.mockRestore()
  })

  it('honours the drawn span when creating (days over = the dragged-out length)', async () => {
    enableDays()
    const r = useStore.getState().addResource({ ...person('Tyler'), workingDays: [1, 2, 3, 4, 5] })
    const user = userEvent.setup()
    // The grid hands the modal a 5-working-day span (Mon 06-01 … Fri 06-05).
    render(<AllocationModal create={{ resourceId: r.id, startDate: '2026-06-01', endDate: '2026-06-05' }} onClose={vi.fn()} />)

    expect(screen.getByLabelText('Days over')).toHaveValue(5)
    expect(screen.getByLabelText('Days of work')).toHaveValue(5) // full-time across the span

    await chooseOption(user, 'Project', 'Acme / Lightning')
    await chooseOption(user, 'Activity', 'Wireframes')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(useStore.getState().data.allocations[0]).toMatchObject({ startDate: '2026-06-01', endDate: '2026-06-05', hoursPerDay: 8 })
  })

  it('does not drift hours when an unevenly-dividing allocation is re-saved unchanged', async () => {
    enableDays()
    const r = useStore.getState().addResource({ ...person('Tyler'), workingDays: [1, 2, 3, 4, 5] })
    // 5h/day over 3 working days = 1.875 days of work — a value 2-dp rounding would distort.
    const alloc = useStore.getState().addAllocation({ resourceId: r.id, activityId: 't1', startDate: '2026-06-01', endDate: '2026-06-03', hoursPerDay: 5, status: 'confirmed' })
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
    const alloc = useStore.getState().addAllocation({ resourceId: r.id, activityId: 't1', startDate: '2026-06-01', endDate: '2026-06-12', hoursPerDay: 4, status: 'confirmed' })
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

    await chooseOption(user, 'Project', 'Acme / Lightning')
    await chooseOption(user, 'Activity', 'Wireframes')
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

    await chooseOption(user, 'Project', 'Acme / Lightning')
    await chooseOption(user, 'Activity', 'Wireframes')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(useStore.getState().data.allocations[0]).toMatchObject({ startDate: '2026-06-01', endDate: '2026-06-05', hoursPerDay: 0 })
  })

  it('rejects a fractional Days over value instead of rounding the saved span', async () => {
    enableBlocks()
    const resource = useStore.getState().addResource({ ...person('Tyler'), workingDays: [1, 2, 3, 4, 5] })
    const user = userEvent.setup()
    render(<AllocationModal create={{ resourceId: resource.id, startDate: '2026-06-01', endDate: '2026-06-01' }} onClose={vi.fn()} />)

    await chooseOption(user, 'Project', 'Acme / Lightning')
    await chooseOption(user, 'Activity', 'Wireframes')
    fireEvent.change(screen.getByLabelText('Days over'), { target: { value: '1.5' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/whole number from 1/i)
    expect(useStore.getState().data.allocations).toHaveLength(0)
  })
})

describe('AllocationModal edit', () => {
  it('reassigns an allocation to another resource', async () => {
    const a = useStore.getState().addResource({ ...person('Alice'), workingDays: [1, 2, 3, 4, 5] })
    const b = useStore.getState().addResource({ ...person('Bob'), workingDays: [1, 2, 3, 4, 5] })
    const alloc = useStore.getState().addAllocation({ resourceId: a.id, activityId: 't1', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' })
    const user = userEvent.setup()
    render(<AllocationModal allocationId={alloc.id} onClose={vi.fn()} />)

    await chooseOption(user, 'Assignee', 'Bob')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(useStore.getState().data.allocations.find((x) => x.id === alloc.id)!.resourceId).toBe(b.id)
  })

  it('snaps the project to the placeholder bound project when reassigned, restricting options', async () => {
    const a = useStore.getState().addResource({ ...person('Alice'), workingDays: [1, 2, 3, 4, 5] })
    useStore.getState().addResource({
      kind: 'placeholder', role: 'Designer', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#a', projectId: 'p2',
    })
    const alloc = useStore.getState().addAllocation({ resourceId: a.id, activityId: 't1', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' })
    const user = userEvent.setup()
    render(<AllocationModal allocationId={alloc.id} onClose={vi.fn()} />)

    await chooseOption(user, 'Assignee', 'Placeholder (slot)')
    expect(screen.getByRole('combobox', { name: 'Project' })).toHaveTextContent('Acme / Other')
    // The non-bound project (p1 / "Lightning") is no longer offered to the placeholder.
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Project' }), { key: 'ArrowDown' })
    expect(screen.queryByRole('option', { name: 'Acme / Lightning' })).not.toBeInTheDocument()
  })

  it('risk A: editing an allocation on a HIDDEN placeholder still offers that placeholder so the value is preserved', async () => {
    const ph = useStore.getState().addResource({
      kind: 'placeholder', role: 'Designer', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#a', projectId: 'p1',
    })
    const alloc = useStore.getState().addAllocation({ resourceId: ph.id, activityId: 't1', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' })
    // Turn placeholders OFF — they're hidden everywhere, but an allocation already on one must not
    // silently reassign when edited: the picker keeps the currently-selected (hidden) placeholder.
    setPlaceholdersEnabled(false)
    render(<AllocationModal allocationId={alloc.id} onClose={vi.fn()} />)

    const assignee = screen.getByRole('combobox', { name: 'Assignee' })
    expect(assignee).toHaveTextContent('Placeholder (slot)')
    // The placeholder option is present (labelled "Placeholder (slot)") even though placeholders are
    // hidden — without it the picker would silently reassign to another available option.
    fireEvent.keyDown(assignee, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: 'Placeholder (slot)' })).toBeInTheDocument()
  })

  it('risk A: editing an allocation on a HIDDEN external still offers that external so the value is preserved', async () => {
    // Externals default OFF too; the suite-wide beforeEach only turns placeholders on. Create an
    // external, book it, then assert the picker keeps it as an option even with the pref OFF.
    const ext = useStore.getState().addResource({
      kind: 'external', name: 'Northstar Partners', role: 'Partner studio', employmentType: 'permanent',
      workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#9ca3af',
    })
    const alloc = useStore.getState().addAllocation({ resourceId: ext.id, activityId: 't1', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 0, status: 'confirmed' })
    // External pref OFF (its default) — hidden everywhere, but an allocation already on one must not
    // silently reassign when edited: the picker keeps the currently-selected (hidden) external.
    setExternalEnabled(false)
    render(<AllocationModal allocationId={alloc.id} onClose={vi.fn()} />)

    const assignee = screen.getByRole('combobox', { name: 'Assignee' })
    expect(assignee).toHaveTextContent('Northstar Partners (external)')
    // The external option is present (labelled "Northstar Partners (external)") even though externals are
    // hidden — without it the picker would silently reassign to another available option.
    fireEvent.keyDown(assignee, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: 'Northstar Partners (external)' })).toBeInTheDocument()
  })

  it('reopens a placeholder→general-activity allocation with the general activity still selected', async () => {
    // A placeholder bound to p1, assigned a GENERAL (no-project) activity. On edit the
    // form must seed Project='' (general) so the general activity stays in the Activity list.
    const ph = useStore.getState().addResource({
      kind: 'placeholder', role: 'Designer', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#a', projectId: 'p1',
    })
    const gen = useStore.getState().addActivity({ name: 'Admin', kind: 'repeatable' })
    const alloc = useStore.getState().addAllocation({ resourceId: ph.id, activityId: gen.id, startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' })
    render(<AllocationModal allocationId={alloc.id} onClose={vi.fn()} />)

    expect(screen.getByRole('combobox', { name: 'Project' })).toHaveTextContent('No project (internal / cross-project)')
    expect(screen.getByRole('combobox', { name: 'Activity' })).toHaveTextContent('Admin')
  })

  it('duplicates an allocation', async () => {
    const a = useStore.getState().addResource({ ...person('Alice'), workingDays: [1, 2, 3, 4, 5] })
    const alloc = useStore.getState().addAllocation({ resourceId: a.id, activityId: 't1', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' })
    const user = userEvent.setup()
    render(<AllocationModal allocationId={alloc.id} onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Duplicate' }))
    expect(useStore.getState().data.allocations).toHaveLength(2)
  })
})

describe('AllocationModal inline activity creation pref', () => {
  const addPerson = () => {
    useStore.getState().addResource({
      kind: 'person', name: 'Tyler', role: 'Designer', employmentType: 'permanent',
      workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#111',
    })
    return useStore.getState().data.resources[0].id
  }

  it('renders the inline "Add activity" input + button by default (pref absent → enabled)', () => {
    const resourceId = addPerson()
    render(<AllocationModal create={{ resourceId, startDate: '2026-06-01', endDate: '2026-06-03' }} onClose={vi.fn()} />)
    expect(screen.getByLabelText('New activity name')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add activity' })).toBeInTheDocument()
  })

  it('hides the inline "Add activity" input + button when inlineActivityCreateEnabled is false — the Activity picker still works', () => {
    const resourceId = addPerson()
    useStore.getState().updateAccount(ACC, { inlineActivityCreateEnabled: false })
    render(<AllocationModal create={{ resourceId, startDate: '2026-06-01', endDate: '2026-06-03' }} onClose={vi.fn()} />)
    // The inline creator is gone…
    expect(screen.queryByLabelText('New activity name')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add activity' })).not.toBeInTheDocument()
    // …but the Activity SelectField is still rendered and usable.
    expect(screen.getByRole('combobox', { name: 'Activity' })).toBeInTheDocument()
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

    await chooseOption(user, 'Project', 'Acme / Lightning')
    await chooseOption(user, 'Activity', 'Wireframes')

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

    await chooseOption(user, 'Project', 'Acme / Lightning')
    await chooseOption(user, 'Activity', 'Wireframes')

    // Pressing Enter in a textarea inserts a newline — it must NOT submit the form
    const noteTextarea = screen.getByLabelText('Note')
    await user.click(noteTextarea)
    await user.keyboard('{Enter}')

    expect(onClose).not.toHaveBeenCalled()
    expect(useStore.getState().data.allocations).toHaveLength(0)
    // The textarea should now contain a newline
    expect(noteTextarea).toHaveValue('\n')
  })

  it('pressing Enter in the new-activity input calls onAddActivity, not submit', async () => {
    useStore.getState().addResource({
      kind: 'person', name: 'Tyler', role: 'Designer', employmentType: 'permanent',
      workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#111',
    })
    const resourceId = useStore.getState().data.resources[0].id
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<AllocationModal create={{ resourceId, startDate: '2026-06-01', endDate: '2026-06-03' }} onClose={onClose} />)

    // Type an activity name into the inline "add new activity" input and press Enter
    await user.click(screen.getByLabelText('New activity name'))
    await user.type(screen.getByLabelText('New activity name'), 'Brand new activity')
    await user.keyboard('{Enter}')

    // The activity should have been created, modal not closed
    expect(onClose).not.toHaveBeenCalled()
    const activities = useStore.getState().data.activities
    expect(activities.some((t) => t.name === 'Brand new activity')).toBe(true)
    expect(screen.getByRole('combobox', { name: 'Activity' })).toHaveTextContent('Brand new activity')
  })
})
