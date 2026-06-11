import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CommandPalette } from './CommandPalette'
import { useStore } from '../store/useStore'
import { makeAppData, makeAccount, makeResourceDraft, DEFAULT_ACCOUNT_ID } from '../test/fixtures'

function renderPalette(onClose = () => {}) {
  return render(
    <MemoryRouter>
      <CommandPalette onClose={onClose} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  useStore.getState().replaceAll(
    makeAppData({
      accounts: [makeAccount()],
    }),
  )
  useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID)
  // Add some resources, clients, projects for search tests
  useStore.getState().addClient({ name: 'Acme Inc.', color: '#6366f1' })
  useStore.getState().addResource(makeResourceDraft({ name: 'Tyler Nix', role: 'Designer' }))
  useStore.getState().addResource(makeResourceDraft({ name: 'Pam Gonzalez', role: 'Copywriter' }))
})

describe('CommandPalette', () => {
  it('renders with the input focused and shows Actions + Pages sections on empty query', () => {
    renderPalette()

    const input = screen.getByTestId('command-palette-input')
    expect(input).toBeInTheDocument()
    expect(document.activeElement).toBe(input)

    // Should show Actions and Pages by default
    expect(screen.getByText('Actions')).toBeInTheDocument()
    expect(screen.getByText('Pages')).toBeInTheDocument()

    // Go to today action
    expect(screen.getByText('Go to today')).toBeInTheDocument()

    // All page entries
    expect(screen.getByText('Schedule')).toBeInTheDocument()
    expect(screen.getByText('Resources')).toBeInTheDocument()
  })

  it('has correct ARIA attributes for combobox pattern', () => {
    renderPalette()

    const input = screen.getByTestId('command-palette-input')
    expect(input).toHaveAttribute('role', 'combobox')
    expect(input).toHaveAttribute('aria-autocomplete', 'list')

    const list = screen.getByRole('listbox')
    expect(list).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-controls', list.id)
  })

  it('shows People section when typing a resource name', () => {
    renderPalette()

    const input = screen.getByTestId('command-palette-input')
    fireEvent.change(input, { target: { value: 'Tyler' } })

    expect(screen.getByText('People')).toBeInTheDocument()
    const options = screen.getAllByTestId('command-palette-option')
    const tylerOption = options.find((o) => o.textContent?.includes('Tyler Nix'))
    expect(tylerOption).toBeTruthy()
  })

  it('shows no results message for unmatched query', () => {
    renderPalette()

    const input = screen.getByTestId('command-palette-input')
    fireEvent.change(input, { target: { value: 'xyzzyxyzzy' } })

    expect(screen.getByText(/No results for/)).toBeInTheDocument()
  })

  it('shows "Go to date" action when query is a valid ISO date', () => {
    renderPalette()

    const input = screen.getByTestId('command-palette-input')
    fireEvent.change(input, { target: { value: '2026-06-03' } })

    expect(screen.getByText('Go to date 2026-06-03')).toBeInTheDocument()
  })

  it('does NOT show "Go to date" action for non-date query', () => {
    renderPalette()

    const input = screen.getByTestId('command-palette-input')
    fireEvent.change(input, { target: { value: '2026-99-99' } })

    expect(screen.queryByText(/Go to date/)).not.toBeInTheDocument()
  })

  it('ArrowDown moves highlight to next option', () => {
    renderPalette()

    const input = screen.getByTestId('command-palette-input')
    // Initially first option is active (aria-selected="true")
    const options = screen.getAllByTestId('command-palette-option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(options[1]).toHaveAttribute('aria-selected', 'false')

    fireEvent.keyDown(input, { key: 'ArrowDown' })

    const updatedOptions = screen.getAllByTestId('command-palette-option')
    expect(updatedOptions[0]).toHaveAttribute('aria-selected', 'false')
    expect(updatedOptions[1]).toHaveAttribute('aria-selected', 'true')
  })

  it('ArrowUp wraps to first when already at first option', () => {
    renderPalette()

    const input = screen.getByTestId('command-palette-input')
    const options = screen.getAllByTestId('command-palette-option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')

    // ArrowUp from first should stay at first (clamped)
    fireEvent.keyDown(input, { key: 'ArrowUp' })

    const updatedOptions = screen.getAllByTestId('command-palette-option')
    expect(updatedOptions[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('Enter selects the active option and closes the palette', () => {
    let closed = false
    renderPalette(() => { closed = true })

    const input = screen.getByTestId('command-palette-input')
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(closed).toBe(true)
  })

  it('Escape closes the palette', () => {
    let closed = false
    renderPalette(() => { closed = true })

    const input = screen.getByTestId('command-palette-input')
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(closed).toBe(true)
  })

  it('mouse hover sets the active option', () => {
    renderPalette()

    const options = screen.getAllByTestId('command-palette-option')
    // Hover the second option
    fireEvent.mouseEnter(options[1])

    expect(options[0]).toHaveAttribute('aria-selected', 'false')
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
  })

  it('backdrop click closes the palette', () => {
    let closed = false
    renderPalette(() => { closed = true })

    // The backdrop is the outer div with data-testid="command-palette"
    const backdrop = screen.getByTestId('command-palette')
    // Simulate a click where target === currentTarget (direct click on backdrop)
    act(() => {
      fireEvent.mouseDown(backdrop, { target: backdrop })
    })

    expect(closed).toBe(true)
  })

  it('jumpToResource is called when a resource is selected', () => {
    renderPalette()

    const input = screen.getByTestId('command-palette-input')
    fireEvent.change(input, { target: { value: 'Tyler' } })

    const options = screen.getAllByTestId('command-palette-option')
    const tylerOption = options.find((o) => o.textContent?.includes('Tyler Nix'))
    expect(tylerOption).toBeTruthy()

    // Click it — should call jumpToResource (store action)
    act(() => {
      fireEvent.mouseDown(tylerOption!)
    })

    // The scrollToResource state should be set in the store
    const sr = useStore.getState().ui.scrollToResource
    expect(sr).not.toBeNull()
    expect(sr?.token).toBeGreaterThan(0)
  })

  it('setFilters is called with projectId when a project is selected', () => {
    // Add a project first
    const clients = useStore.getState().data.clients
    const client = clients[0]
    act(() => {
      useStore.getState().addProject({ name: 'Project Lightning', clientId: client.id, color: '#6366f1' })
    })

    renderPalette()

    const input = screen.getByTestId('command-palette-input')
    fireEvent.change(input, { target: { value: 'Lightning' } })

    const options = screen.getAllByTestId('command-palette-option')
    const projectOption = options.find((o) => o.textContent?.includes('Project Lightning'))
    expect(projectOption).toBeTruthy()

    act(() => {
      fireEvent.mouseDown(projectOption!)
    })

    // The filters should be updated
    const filters = useStore.getState().ui.filters
    expect(filters.projectId).not.toBeNull()
  })
})
