import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { GettingStarted } from './GettingStarted'
import { resetStoreWithAccount } from '../test/fixtures'
import { useStore } from '../store/useStore'
import { PermissionContext } from '../auth/permissionContext'
import type { Role } from '@capacitylens/shared/domain/access'
import indexCss from '../index.css?raw'

const tourMock = vi.hoisted(() => ({ startTour: vi.fn<() => Promise<void>>() }))

vi.mock('../lib/tour', () => ({ startTour: tourMock.startTour }))

beforeEach(() => {
  tourMock.startTour.mockReset().mockResolvedValue(undefined)
  resetStoreWithAccount()
  useStore.getState().setGettingStartedDismissed(false)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function renderChecklist(role: Role | null) {
  return render(
    <MemoryRouter>
      <PermissionContext.Provider
        value={{ role, status: role ? 'resolved' : 'not-applicable' }}
      >
        <GettingStarted />
      </PermissionContext.Provider>
    </MemoryRouter>,
  )
}

describe('GettingStarted access step', () => {
  it('renders incomplete and completed checklist rows from active company data', () => {
    const initial = renderChecklist('editor')

    expect(
      screen.getByRole('link', { name: 'Add your first client' }),
    ).toHaveAttribute('href', '/clients')
    initial.unmount()

    useStore.getState().addClient({ name: 'Acme', color: '#2d75da' })
    renderChecklist('editor')

    expect(
      screen.queryByRole('link', { name: 'Add your first client' }),
    ).not.toBeInTheDocument()
    const completed = screen.getByText('Add your first client')
    expect(completed).toHaveClass('line-through')
    expect(completed).toHaveTextContent('Done: Add your first client')
  })

  it('starts the orientation tour from the card action', async () => {
    const user = userEvent.setup()
    renderChecklist('editor')

    await user.click(screen.getByTestId('getting-started-tour'))

    expect(tourMock.startTour).toHaveBeenCalledOnce()
  })

  it('dismisses the card and persists the device preference', async () => {
    const user = userEvent.setup()
    renderChecklist('editor')

    await user.click(screen.getByTestId('getting-started-dismiss'))

    expect(screen.queryByTestId('getting-started')).not.toBeInTheDocument()
    expect(useStore.getState().gettingStartedDismissed).toBe(true)
    expect(localStorage.getItem('capacitylens/gettingStartedDismissed')).toBe(
      'on',
    )
  })

  it('surfaces a rejected lazy tour load without an unhandled failure', async () => {
    const failure = new Error('chunk unavailable')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    tourMock.startTour.mockRejectedValueOnce(failure)
    const user = userEvent.setup()
    renderChecklist('editor')

    await user.click(screen.getByRole('button', { name: 'Show me around' }))

    await vi.waitFor(() => {
      expect(useStore.getState().notice).toEqual({
        message:
          'The tour could not start. Check your connection and try again.',
        tone: 'error',
      })
    })
    expect(error).toHaveBeenCalledWith(
      'GettingStarted: tour failed to start',
      failure,
    )
  })

  it('keeps the bounded card pointer-interactive so overflow can wheel or touch scroll', () => {
    expect(indexCss).toMatch(
      /\.getting-started-popover\s*\{[^}]*overflow-y:\s*auto;[^}]*pointer-events:\s*auto;/,
    )
    expect(indexCss).not.toMatch(
      /\.getting-started-popover\s*\{[^}]*pointer-events:\s*none;/,
    )
  })

  it.each(['owner', 'admin'] as const)(
    'offers %s the optional Team & access path',
    (role) => {
      renderChecklist(role)

      expect(
        screen.getByRole('link', { name: 'Invite your team' }),
      ).toHaveAttribute('href', '/team')
      expect(
        screen.getByText(/Optional — you can finish the schedule first/),
      ).toBeInTheDocument()
    },
  )

  it('does not offer an Editor a member-management action', () => {
    renderChecklist('editor')

    expect(
      screen.queryByRole('link', { name: 'Invite your team' }),
    ).not.toBeInTheDocument()
  })

  it('does not render any onboarding actions for a Viewer', () => {
    renderChecklist('viewer')

    expect(screen.queryByTestId('getting-started')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Invite your team' }),
    ).not.toBeInTheDocument()
  })

  it('uses the account-keyed permission context instead of stale store role state', () => {
    useStore.getState().setActiveRole('owner')
    renderChecklist('editor')

    expect(
      screen.queryByRole('link', { name: 'Invite your team' }),
    ).not.toBeInTheDocument()
  })
})
