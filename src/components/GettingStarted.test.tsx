import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { GettingStarted } from './GettingStarted'
import { resetStoreWithAccount } from '../test/fixtures'
import { useStore } from '../store/useStore'
import { PermissionContext } from '../auth/permissionContext'
import type { Role } from '@capacitylens/shared/domain/access'

beforeEach(() => {
  resetStoreWithAccount()
  useStore.getState().setGettingStartedDismissed(false)
})

function renderChecklist(role: Role | null) {
  return render(
    <MemoryRouter>
      <PermissionContext.Provider value={{ role, status: role ? 'resolved' : 'not-applicable' }}>
        <GettingStarted />
      </PermissionContext.Provider>
    </MemoryRouter>,
  )
}

describe('GettingStarted access step', () => {
  it.each(['owner', 'admin'] as const)('offers %s the optional Team & access path', (role) => {
    renderChecklist(role)

    expect(screen.getByRole('link', { name: 'Invite your team' })).toHaveAttribute('href', '/team')
    expect(screen.getByText(/Optional — you can finish the schedule first/)).toBeInTheDocument()
  })

  it('does not offer an Editor a member-management action', () => {
    renderChecklist('editor')

    expect(screen.queryByRole('link', { name: 'Invite your team' })).not.toBeInTheDocument()
  })

  it('does not render any onboarding actions for a Viewer', () => {
    renderChecklist('viewer')

    expect(screen.queryByTestId('getting-started')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Invite your team' })).not.toBeInTheDocument()
  })

  it('uses the account-keyed permission context instead of stale store role state', () => {
    useStore.getState().setActiveRole('owner')
    renderChecklist('editor')

    expect(screen.queryByRole('link', { name: 'Invite your team' })).not.toBeInTheDocument()
  })
})
