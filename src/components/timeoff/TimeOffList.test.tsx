import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TimeOffList } from './TimeOffList'
import { TimeOffForm } from './TimeOffForm'
import { useStore } from '../../store/useStore'
import { WORKDAYS, resetStoreWithAccount, setPlaceholdersEnabled } from '../../test/fixtures'

const resourceDraft = {
  kind: 'person' as const,
  name: 'Alice',
  role: 'Designer',
  employmentType: 'permanent' as const,
  workingHoursPerDay: 8,
  workingDays: WORKDAYS,
  color: '#111',
}

// A placeholder ("slot") resource. Placeholders carry no name and render as the literal word
// "Placeholder" via resourceDisplayName.
const placeholderDraft = {
  kind: 'placeholder' as const,
  role: 'Designer',
  employmentType: 'permanent' as const,
  workingHoursPerDay: 8,
  workingDays: WORKDAYS,
  color: '#222',
}

beforeEach(() => {
  resetStoreWithAccount()
  useStore.getState().clearFilters()
  // The placeholder-hiding behaviour is the system under test in some cases; default the device
  // pref ON here so the pre-existing tests are unaffected, and flip it OFF in the dedicated tests.
  setPlaceholdersEnabled(true)
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
    fireEvent.keyDown(within(dialog).getByLabelText('Resource'), { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('option', { name: resource.name }))

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

    fireEvent.keyDown(within(dialog).getByLabelText('Resource'), { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('option', { name: resource.name }))
    fireEvent.change(within(dialog).getByLabelText('Start'), { target: { value: '2026-07-01' } })
    fireEvent.change(within(dialog).getByLabelText('End'), { target: { value: '2026-07-05' } })

    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    // Modal should be gone
    expect(screen.queryByRole('dialog', { name: 'Add time off' })).not.toBeInTheDocument()

    // Time-off row should be present with the resource name, the terse start date and a day count
    // (2026-07-01 is a Wednesday; 01→05 July is five inclusive days). The end date isn't shown.
    const row = screen.getByTestId('timeoff-row')
    expect(row).toHaveTextContent('Alice')
    expect(row).toHaveTextContent('Wed 1st Jul')
    expect(row).toHaveTextContent('5 days')
    expect(row).not.toHaveTextContent('2026-07-01') // the raw ISO string is no longer shown

    expect(useStore.getState().data.timeOff).toHaveLength(1)
    expect(useStore.getState().data.timeOff[0].resourceId).toBe(resource.id)
  })

  it('keeps the row spare — start date and day count only, never the end date, type or note', () => {
    const resource = useStore.getState().addResource(resourceDraft)
    useStore.getState().addTimeOff({
      resourceId: resource.id,
      startDate: '2026-08-01', // Saturday
      endDate: '2026-08-05', // five inclusive days
      type: 'holiday',
      note: 'Visiting family',
    })
    render(<TimeOffList />)
    const row = screen.getByTestId('timeoff-row')
    // Shown: who, the terse start date, and how many days.
    expect(row).toHaveTextContent('Sat 1st Aug')
    expect(row).toHaveTextContent('5 days')
    // Intentionally omitted from this view (still stored; the type still shows on the timeline block).
    expect(row).not.toHaveTextContent('5th Aug') // the end date (Wed 5th Aug) isn't surfaced
    expect(row).not.toHaveTextContent('Holiday')
    expect(row).not.toHaveTextContent('holiday')
    expect(row).not.toHaveTextContent('Visiting family')
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
    const dialog = screen.getByRole('alertdialog', { name: 'Delete time off?' })
    expect(dialog).toBeInTheDocument()

    // Cancel keeps the entry
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(useStore.getState().data.timeOff).toHaveLength(1)
    expect(screen.getByTestId('timeoff-row')).toBeInTheDocument()

    // Delete again and confirm
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(within(screen.getByRole('alertdialog', { name: 'Delete time off?' })).getByRole('button', { name: 'Delete' }))

    expect(useStore.getState().data.timeOff).toHaveLength(0)
    expect(screen.queryByTestId('timeoff-row')).not.toBeInTheDocument()
  })

  it('shows a placeholder time-off entry (named "Placeholder") when placeholders are ON', () => {
    setPlaceholdersEnabled(true)
    const ph = useStore.getState().addResource(placeholderDraft)
    useStore.getState().addTimeOff({ resourceId: ph.id, startDate: '2026-09-01', endDate: '2026-09-05', type: 'holiday' })
    render(<TimeOffList />)

    const row = screen.getByTestId('timeoff-row')
    expect(row).toHaveTextContent('Placeholder') // resourceDisplayName, consistent with everywhere else
    expect(row).not.toHaveTextContent('Designer') // not the placeholder's role
  })

  it('HIDES a placeholder time-off entry when placeholders are OFF (data stays intact)', () => {
    setPlaceholdersEnabled(true)
    const ph = useStore.getState().addResource(placeholderDraft)
    useStore.getState().addTimeOff({ resourceId: ph.id, startDate: '2026-09-01', endDate: '2026-09-05', type: 'holiday' })

    // Turn placeholders OFF — the entry must disappear from the rendered list…
    setPlaceholdersEnabled(false)
    render(<TimeOffList />)
    expect(screen.queryByTestId('timeoff-row')).not.toBeInTheDocument()
    // …falling through to the empty-state, not an error.
    expect(screen.getByText('No time off booked.')).toBeInTheDocument()
    // …but the data itself is untouched (pure view gate, not a delete).
    expect(useStore.getState().data.timeOff).toHaveLength(1)
  })

  it('still shows a non-placeholder entry when a placeholder entry is hidden (OFF)', () => {
    setPlaceholdersEnabled(true)
    const alice = useStore.getState().addResource(resourceDraft)
    const ph = useStore.getState().addResource(placeholderDraft)
    useStore.getState().addTimeOff({ resourceId: alice.id, startDate: '2026-09-01', endDate: '2026-09-05', type: 'holiday' })
    useStore.getState().addTimeOff({ resourceId: ph.id, startDate: '2026-09-10', endDate: '2026-09-12', type: 'sick' })

    setPlaceholdersEnabled(false)
    render(<TimeOffList />)

    const rows = screen.getAllByTestId('timeoff-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('Alice')
    expect(screen.queryByText('Placeholder')).not.toBeInTheDocument()
  })
})

describe('TimeOffForm resource picker (placeholder gating)', () => {
  it('EXCLUDES placeholders from the picker when the pref is OFF', async () => {
    setPlaceholdersEnabled(false)
    useStore.getState().addResource(resourceDraft) // a person, should appear
    useStore.getState().addResource(placeholderDraft) // a placeholder, should be omitted
    render(<TimeOffForm onClose={() => {}} />)

    const select = screen.getByLabelText('Resource')
    fireEvent.keyDown(select, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: 'Alice' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Placeholder' })).not.toBeInTheDocument()
  })

  it('risk A: editing a time-off entry already ON a hidden placeholder still offers that placeholder', async () => {
    setPlaceholdersEnabled(true)
    const ph = useStore.getState().addResource(placeholderDraft)
    const entry = useStore.getState().addTimeOff({ resourceId: ph.id, startDate: '2026-09-01', endDate: '2026-09-05', type: 'holiday' })

    // Hide placeholders, then edit the existing placeholder entry. The picker must keep the
    // currently-selected (hidden) placeholder so the value shows and the entry can't silently
    // reassign on save.
    setPlaceholdersEnabled(false)
    render(<TimeOffForm timeOff={entry} onClose={() => {}} />)

    const select = screen.getByLabelText('Resource')
    expect(select).toHaveTextContent('Placeholder')
    fireEvent.keyDown(select, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: 'Placeholder' })).toBeInTheDocument()
  })
})
