import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TimeOffList } from './TimeOffList'
import { useStore } from '../../store/useStore'
import { WORKDAYS, resetStoreWithAccount } from '../../test/fixtures'

const resourceDraft = {
  kind: 'person' as const,
  name: 'Alice',
  role: 'Designer',
  employmentType: 'permanent' as const,
  workingHoursPerDay: 8,
  workingDays: WORKDAYS,
  color: '#111',
}

beforeEach(() => {
  resetStoreWithAccount()
  useStore.getState().clearFilters()
})

describe('TimeOffList', () => {
  it('shows an error when saving without selecting a resource', async () => {
    const user = userEvent.setup()
    render(<TimeOffList />)

    await user.click(screen.getByRole('button', { name: 'Add time off' }))
    const dialog = screen.getByRole('dialog', { name: 'Add time off' })
    expect(dialog).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/choose a resource/i)
    expect(useStore.getState().data.timeOff).toHaveLength(0)
  })

  it('shows an error when end date is before start date', async () => {
    const user = userEvent.setup()
    useStore.getState().addResource(resourceDraft)
    const resource = useStore.getState().data.resources[0]
    render(<TimeOffList />)

    await user.click(screen.getByRole('button', { name: 'Add time off' }))
    const dialog = screen.getByRole('dialog', { name: 'Add time off' })

    // Select the resource first (otherwise validation stops at "choose a resource")
    await user.selectOptions(within(dialog).getByLabelText('Resource'), resource.id)

    // Set start to a later date and end to an earlier date
    fireEvent.change(within(dialog).getByLabelText('Start'), { target: { value: '2026-06-10' } })
    fireEvent.change(within(dialog).getByLabelText('End'), { target: { value: '2026-06-01' } })

    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/end date cannot be before the start date/i)
    expect(useStore.getState().data.timeOff).toHaveLength(0)
  })

  it('lists the time-off entry after a valid save', async () => {
    const user = userEvent.setup()
    useStore.getState().addResource(resourceDraft)
    const resource = useStore.getState().data.resources[0]
    render(<TimeOffList />)

    await user.click(screen.getByRole('button', { name: 'Add time off' }))
    const dialog = screen.getByRole('dialog', { name: 'Add time off' })

    await user.selectOptions(within(dialog).getByLabelText('Resource'), resource.id)
    fireEvent.change(within(dialog).getByLabelText('Start'), { target: { value: '2026-07-01' } })
    fireEvent.change(within(dialog).getByLabelText('End'), { target: { value: '2026-07-05' } })

    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    // Modal should be gone
    expect(screen.queryByRole('dialog', { name: 'Add time off' })).not.toBeInTheDocument()

    // Time-off row should be present with resource name and dates
    const row = screen.getByTestId('timeoff-row')
    expect(row).toHaveTextContent('Alice')
    expect(row).toHaveTextContent('2026-07-01')
    expect(row).toHaveTextContent('2026-07-05')

    expect(useStore.getState().data.timeOff).toHaveLength(1)
    expect(useStore.getState().data.timeOff[0].resourceId).toBe(resource.id)
  })

  it('shows the human label for the time-off type, not the raw lowercase enum', () => {
    const resource = useStore.getState().addResource(resourceDraft)
    useStore.getState().addTimeOff({ resourceId: resource.id, startDate: '2026-08-01', endDate: '2026-08-05', type: 'holiday' })
    render(<TimeOffList />)
    const row = screen.getByTestId('timeoff-row')
    expect(row).toHaveTextContent('Holiday') // label from metadata, matching the timeline
    expect(row).not.toHaveTextContent('holiday') // not the raw enum value
  })

  it('confirms before deleting and removes the entry on confirm', async () => {
    const user = userEvent.setup()
    const resource = useStore.getState().addResource(resourceDraft)
    useStore.getState().addTimeOff({
      resourceId: resource.id,
      startDate: '2026-08-01',
      endDate: '2026-08-05',
      type: 'holiday',
    })
    render(<TimeOffList />)

    expect(screen.getByTestId('timeoff-row')).toBeInTheDocument()

    // Click Delete on the row
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    // Confirm dialog appears
    const dialog = screen.getByRole('dialog', { name: 'Delete time off?' })
    expect(dialog).toBeInTheDocument()

    // Cancel keeps the entry
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(useStore.getState().data.timeOff).toHaveLength(1)
    expect(screen.getByTestId('timeoff-row')).toBeInTheDocument()

    // Delete again and confirm
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Delete time off?' })).getByRole('button', { name: 'Delete' }))

    expect(useStore.getState().data.timeOff).toHaveLength(0)
    expect(screen.queryByTestId('timeoff-row')).not.toBeInTheDocument()
  })
})
