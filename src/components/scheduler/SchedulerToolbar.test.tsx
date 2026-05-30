import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SchedulerToolbar } from './SchedulerToolbar'
import { useStore } from '../../store/useStore'
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

describe('SchedulerToolbar undo/redo buttons', () => {
  it('Undo and Redo are disabled when history is empty', () => {
    render(<SchedulerToolbar />)

    expect(screen.getByTitle('Undo (⌘Z)')).toBeDisabled()
    expect(screen.getByTitle('Redo (⌘⇧Z)')).toBeDisabled()
  })

  it('Undo becomes enabled after a store data mutation', async () => {
    render(<SchedulerToolbar />)

    expect(screen.getByTitle('Undo (⌘Z)')).toBeDisabled()

    act(() => {
      useStore.getState().addClient({ name: 'Acme', color: '#111' })
    })

    expect(screen.getByTitle('Undo (⌘Z)')).toBeEnabled()
  })

  it('Redo becomes enabled after an undo', async () => {
    render(<SchedulerToolbar />)

    act(() => {
      useStore.getState().addClient({ name: 'Acme', color: '#111' })
    })

    expect(screen.getByTitle('Undo (⌘Z)')).toBeEnabled()
    expect(screen.getByTitle('Redo (⌘⇧Z)')).toBeDisabled()

    act(() => {
      useStore.getState().undo()
    })

    expect(screen.getByTitle('Undo (⌘Z)')).toBeDisabled()
    expect(screen.getByTitle('Redo (⌘⇧Z)')).toBeEnabled()
  })
})

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
})
