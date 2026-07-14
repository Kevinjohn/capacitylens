import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SchedulerToolbar } from './SchedulerToolbar'
import { emptyFilters, useStore } from '../../store/useStore'
import { resetStoreWithAccount } from '../../test/fixtures'

beforeEach(() => {
  resetStoreWithAccount()
  useStore.getState().clearFilters()
  useStore.getState().setZoom(4)
})

describe('SchedulerToolbar zoom control', () => {
  it('clicking a zoom level sets ui.zoom (weeks visible)', async () => {
    const user = userEvent.setup()
    render(<SchedulerToolbar />)

    await user.click(screen.getByRole('button', { name: '8w' }))
    expect(useStore.getState().ui.zoom).toBe(8)

    await user.click(screen.getByRole('button', { name: '1w' }))
    expect(useStore.getState().ui.zoom).toBe(1)
  })
})

describe('SchedulerToolbar search filter', () => {
  it('typing in the Search field updates ui.filters.search', async () => {
    const user = userEvent.setup()
    render(<SchedulerToolbar />)

    await user.type(screen.getByLabelText('Search people'), 'Alice')

    // The search is debounced into the store, so the update lands shortly after typing.
    await waitFor(() => expect(useStore.getState().ui.filters.search).toBe('Alice'))
  })
})

// The Undo/Redo toolbar buttons (undo-button / redo-button) and the keyboard path
// (⌘Z / ⌘⇧Z via AppShell) are both exercised end-to-end in e2e/toolbar.spec.ts.

describe('SchedulerToolbar Clear filter button', () => {
  it('Clear button is absent when no filters are set', () => {
    render(<SchedulerToolbar />)

    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
  })

  it('Clear button appears once a filter is set', async () => {
    const user = userEvent.setup()
    render(<SchedulerToolbar />)

    await user.type(screen.getByLabelText('Search people'), 'Bob')

    // Clear appears once the debounced search reaches the store.
    expect(await screen.findByRole('button', { name: 'Clear' })).toBeInTheDocument()
  })

  it('clicking Clear resets all filters and hides the Clear button', async () => {
    const user = userEvent.setup()
    render(<SchedulerToolbar />)

    await user.type(screen.getByLabelText('Search people'), 'Bob')
    expect(await screen.findByRole('button', { name: 'Clear' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear' }))

    expect(useStore.getState().ui.filters.search).toBe('')
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
  })

  it('Clear cancels a pending search debounce so a cleared term cannot reappear', async () => {
    const user = userEvent.setup()
    // A non-search filter is active so Clear renders immediately, before the debounce.
    useStore.getState().setFilters({ disciplineId: 'd1' })
    render(<SchedulerToolbar />)

    await user.type(screen.getByLabelText('Search people'), 'jo') // schedules a 180ms timer
    await user.click(screen.getByRole('button', { name: 'Clear' })) // must cancel it

    // Wait past the debounce window: the orphaned timer must NOT re-apply "jo".
    await new Promise((r) => setTimeout(r, 250))
    expect(useStore.getState().ui.filters.search).toBe('')
    expect((screen.getByLabelText('Search people') as HTMLInputElement).value).toBe('')
  })

  it('an EXTERNAL filters.search reset (e.g. account switch) cancels a pending search debounce', async () => {
    useStore.getState().setFilters({ search: 'alice' }) // a committed search
    render(<SchedulerToolbar />)

    const box = screen.getByLabelText('Search people') as HTMLInputElement
    // Type a new term — schedules a 180ms timer to setFilters({ search: 'bob' }); filters.search
    // is still 'alice' (the debounce hasn't fired).
    fireEvent.change(box, { target: { value: 'bob' } })
    // Simulate the external reset an account switch performs (filters → emptyFilters).
    useStore.getState().setFilters({ search: '' })

    // Past the debounce window: the stale 'bob' must NOT have clobbered the cleared value.
    await new Promise((r) => setTimeout(r, 250))
    expect(useStore.getState().ui.filters.search).toBe('')
  })

  it('a filters REPLACEMENT that leaves search unchanged (palette selection) still kills a pending debounce', async () => {
    render(<SchedulerToolbar />)
    const box = screen.getByLabelText('Search people') as HTMLInputElement

    // Pending term: the store's search is '' and STAYS '' through the replacement below,
    // so any logic keyed on the search VALUE cannot see this write — the race the palette
    // e2e spec kept tripping (the timer resurrected the stale term over the replacement).
    fireEvent.change(box, { target: { value: 'zzz-nobody-matches-zzz' } })
    // What CommandPalette's project selection does: REPLACE the filters wholesale.
    useStore.getState().setFilters({ ...emptyFilters(), projectId: 'p1' })

    await new Promise((r) => setTimeout(r, 250))
    expect(useStore.getState().ui.filters.search).toBe('') // not resurrected
    expect(useStore.getState().ui.filters.projectId).toBe('p1') // replacement intact
    expect(box.value).toBe('') // stale text gone from the box too
  })
})

describe('SchedulerToolbar Activities filter (standalone lens)', () => {
  // Seed one internal + one repeatable activity so the Activities dropdown renders (it covers only the
  // project-less kinds; project activities are reached via the Projects dropdown).
  const seedLensActivities = () => ({
    internal: useStore.getState().addActivity({ name: 'Admin', kind: 'internal' }),
    repeatable: useStore.getState().addActivity({ name: 'Design', kind: 'repeatable' }),
  })

  it('renders the Activities dropdown with grouped Internal / Repeatable options', () => {
    seedLensActivities()
    render(<SchedulerToolbar />)
    const select = screen.getByLabelText('Filter by activity')
    expect(select).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Internal — All' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Repeatable — All' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Admin' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Design' })).toBeInTheDocument()
  })

  it('is absent when the account has no project-less activities', () => {
    render(<SchedulerToolbar />)
    expect(screen.queryByLabelText('Filter by activity')).not.toBeInTheDocument()
  })

  it('selecting a specific activity sets activityId and clears the client/project lens', async () => {
    const user = userEvent.setup()
    const { repeatable } = seedLensActivities()
    useStore.getState().setFilters({ projectId: 'p1' }) // an active project lens
    render(<SchedulerToolbar />)

    await user.selectOptions(screen.getByLabelText('Filter by activity'), repeatable.id)

    expect(useStore.getState().ui.filters.activityId).toBe(repeatable.id)
    expect(useStore.getState().ui.filters.activityKind).toBeNull()
    expect(useStore.getState().ui.filters.projectId).toBeNull() // standalone lens cleared it
  })

  it('selecting "Internal — All" sets activityKind and clears the client/project lens', async () => {
    const user = userEvent.setup()
    seedLensActivities()
    useStore.getState().setFilters({ clientId: 'c1' })
    render(<SchedulerToolbar />)

    await user.selectOptions(screen.getByLabelText('Filter by activity'), 'kind:internal')

    expect(useStore.getState().ui.filters.activityKind).toBe('internal')
    expect(useStore.getState().ui.filters.activityId).toBeNull()
    expect(useStore.getState().ui.filters.clientId).toBeNull()
  })

  it('selecting a project clears an active activity lens (mutual exclusion both ways)', async () => {
    const user = userEvent.setup()
    const { repeatable } = seedLensActivities()
    const client = useStore.getState().addClient({ name: 'Acme', color: '#111' })
    const project = useStore.getState().addProject({ name: 'Lightning', clientId: client.id, color: '#222' })
    useStore.getState().setFilters({ activityId: repeatable.id })
    render(<SchedulerToolbar />)

    await user.selectOptions(screen.getByLabelText('Filter by project'), project.id)

    expect(useStore.getState().ui.filters.projectId).toBe(project.id)
    expect(useStore.getState().ui.filters.activityId).toBeNull()
    expect(useStore.getState().ui.filters.activityKind).toBeNull()
  })
})
