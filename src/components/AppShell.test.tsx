import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppShell } from './AppShell'
import { useStore } from '../store/useStore'
import { emptyAppData } from '../types/entities'

beforeEach(() => {
  useStore.getState().replaceAll(emptyAppData())
  useStore.getState().clearFilters()
  // Reset hydrated state to false before each test
  useStore.getState().setHydrated(false)
})

function renderAppShell(initialEntries: string[] = ['/']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AppShell />
    </MemoryRouter>,
  )
}

describe('AppShell navigation links', () => {
  it('renders all expected nav links', () => {
    renderAppShell()

    expect(screen.getByRole('link', { name: 'Schedule' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Resources' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Disciplines' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Clients' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Tasks' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Time off' })).toBeInTheDocument()
  })

  it('renders the Floaty brand name in the nav', () => {
    renderAppShell()
    expect(screen.getByText('Floaty')).toBeInTheDocument()
  })

  it('renders Export and Import buttons', () => {
    renderAppShell()

    expect(screen.getByTestId('export-data')).toBeInTheDocument()
    expect(screen.getByTestId('import-data')).toBeInTheDocument()
  })

  it('nav links point to correct routes', () => {
    renderAppShell()

    expect(screen.getByRole('link', { name: 'Schedule' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'Resources' })).toHaveAttribute('href', '/resources')
    expect(screen.getByRole('link', { name: 'Disciplines' })).toHaveAttribute('href', '/disciplines')
    expect(screen.getByRole('link', { name: 'Clients' })).toHaveAttribute('href', '/clients')
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '/projects')
    expect(screen.getByRole('link', { name: 'Tasks' })).toHaveAttribute('href', '/tasks')
    expect(screen.getByRole('link', { name: 'Time off' })).toHaveAttribute('href', '/timeoff')
  })
})

describe('AppShell hydration gate', () => {
  it('shows "Loading…" when the store is not hydrated', () => {
    renderAppShell()

    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('does not render the outlet area when not hydrated', () => {
    renderAppShell()

    // The loading placeholder should be shown, not the outlet content area
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.queryByRole('main')?.textContent).toContain('Loading')
  })

  it('hides "Loading…" and renders outlet area after setHydrated(true)', () => {
    renderAppShell()

    // Initially shows loading
    expect(screen.getByText('Loading…')).toBeInTheDocument()

    // Set hydrated inside act so React processes the state update
    act(() => {
      useStore.getState().setHydrated(true)
    })

    // Loading text should be gone, outlet rendered instead
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
  })

  it('renders outlet area immediately when hydrated is already true', () => {
    useStore.getState().setHydrated(true)

    renderAppShell()

    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
  })
})

describe('AppShell Export/Import section', () => {
  it('shows the Export JSON button with correct test id', () => {
    renderAppShell()
    const exportBtn = screen.getByTestId('export-data')
    expect(exportBtn).toBeInTheDocument()
    expect(exportBtn.tagName).toBe('BUTTON')
    expect(exportBtn).toHaveTextContent('Export JSON')
  })

  it('shows the Import JSON button with correct test id', () => {
    renderAppShell()
    const importBtn = screen.getByTestId('import-data')
    expect(importBtn).toBeInTheDocument()
    expect(importBtn.tagName).toBe('BUTTON')
    expect(importBtn).toHaveTextContent('Import JSON')
  })

  it('has a hidden file input for importing', () => {
    renderAppShell()
    const input = screen.getByTestId('import-input')
    expect(input).toBeInTheDocument()
    expect(input).toHaveAttribute('type', 'file')
    expect(input).toHaveAttribute('accept', 'application/json')
  })
})

describe('AppShell transient notice', () => {
  it('renders a toast for a store notice and clears it on dismiss', () => {
    renderAppShell()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    act(() => {
      useStore.getState().setNotice('That allocation could not be moved there.')
    })
    expect(screen.getByRole('alert')).toHaveTextContent('could not be moved')

    act(() => {
      screen.getByRole('button', { name: 'Dismiss' }).click()
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
