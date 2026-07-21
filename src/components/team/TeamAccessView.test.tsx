import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Role } from '@capacitylens/shared/domain/access'
import { PermissionContext } from '../../auth/permissionContext'
import { AuthContext, type AuthContextValue } from '../../auth/authContext'
import { TeamAccessView } from './TeamAccessView'
import { setOfflineReadState } from '../../data/offlineCache'

const buildMode = vi.hoisted(() => ({ demo: false }))
vi.mock('../../data/apiConfig', () => ({
  isServerConfigured: () => true,
  isDemoMode: () => buildMode.demo,
  API_BASE: 'http://api.test',
}))

vi.mock('../settings/MembersSection', () => ({
  MembersSection: () => <div data-testid="member-management">Member controls</div>,
}))

const auth = (authMode: AuthContextValue['authMode']): AuthContextValue => ({
  authMode,
  user: authMode === 'off' ? null : { id: 'me', email: 'me@example.com' },
  canCreateAccount: true,
  multiAccount: true,
  refreshAuth: async () => {},
  signOut: async () => {},
})

function renderView(
  role: Role | null,
  authMode: AuthContextValue['authMode'],
  status: 'not-applicable' | 'pending' | 'resolved' | 'unavailable' = role ? 'resolved' : 'not-applicable',
) {
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={auth(authMode)}>
        <PermissionContext.Provider value={{ role, status }}>
          <TeamAccessView />
        </PermissionContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

describe('TeamAccessView', () => {
  beforeEach(() => {
    buildMode.demo = false
    setOfflineReadState(false)
  })

  afterEach(() => {
    setOfflineReadState(false)
  })

  it('labels the demo honestly and explains members versus resources', () => {
    buildMode.demo = true
    renderView(null, 'off')
    expect(screen.getByTestId('current-access')).toHaveTextContent('Demo access')
    expect(screen.getByText(/not a real company membership/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'App members' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Scheduled resources' })).toBeInTheDocument()
    expect(screen.queryByTestId('member-management')).not.toBeInTheDocument()
  })

  it('distinguishes an auth-off persisted server from the in-memory demo', () => {
    renderView(null, 'off')

    expect(screen.getByTestId('current-access')).toHaveTextContent('Open access')
    expect(screen.getByText(/persisted on the server, but authentication and membership roles are disabled/i)).toBeInTheDocument()
    expect(screen.getByText(/Anyone who can reach this installation can view and edit/i)).toBeInTheDocument()
  })

  it('shows every Viewer capability and keeps management understandable but unavailable', () => {
    renderView('viewer', 'password')
    expect(screen.getByTestId('current-access')).toHaveTextContent('Viewer')
    expect(screen.getByText('View the schedule')).toBeInTheDocument()
    expect(screen.getByText('Edit scheduling data')).toHaveClass('text-muted-foreground')
    expect(screen.getByText('View the schedule').closest('li')).toHaveTextContent('Allowed:')
    expect(screen.getByText('Edit scheduling data').closest('li')).toHaveTextContent('Not allowed:')
    expect(screen.getByText(/An Owner or Admin manages invitations/)).toBeInTheDocument()
    expect(screen.getByTestId('member-management')).not.toBeVisible()
  })

  it('shows management controls to the single Owner', () => {
    renderView('owner', 'password')
    expect(screen.getByTestId('current-access')).toHaveTextContent('single Owner')
    expect(screen.getByTestId('member-management')).toBeInTheDocument()
  })

  it.each([
    ['pending', 'Checking access'],
    ['unavailable', 'Access unavailable'],
  ] as const)('does not present Viewer as authoritative while membership is %s', (status, label) => {
    renderView('viewer', 'password', status)

    expect(screen.getByTestId('current-access')).toHaveTextContent(label)
    expect(screen.getByTestId('current-access')).not.toHaveTextContent('Viewer')
    expect(screen.getByTestId('member-management')).not.toBeVisible()
  })

  it('keeps member management mounted while a membership recheck fails closed', () => {
    const view = renderView('owner', 'password', 'resolved')
    const controls = screen.getByTestId('member-management')
    expect(controls).toBeVisible()

    view.rerender(
      <MemoryRouter>
        <AuthContext.Provider value={auth('password')}>
          <PermissionContext.Provider value={{ role: 'viewer', status: 'pending' }}>
            <TeamAccessView />
          </PermissionContext.Provider>
        </AuthContext.Provider>
      </MemoryRouter>,
    )

    expect(controls).toBeInTheDocument()
    expect(screen.getByTestId('member-management')).toBe(controls)
    expect(controls).not.toBeVisible()
  })

  it.each([
    ['authenticated Owner', 'owner', 'password'],
    ['auth-off installation', null, 'off'],
  ] as const)('projects cached data as Viewer-only for an %s', (_label, role, authMode) => {
    setOfflineReadState(true, Date.parse('2026-07-17T10:00:00.000Z'))
    renderView(role, authMode)

    const current = screen.getByTestId('current-access')
    expect(current).toHaveTextContent('Offline · View only')
    expect(current).toHaveTextContent(/cached snapshot/i)
    expect(screen.getByText('View the schedule').closest('li')).toHaveTextContent('Allowed:')
    expect(screen.getByText('Edit scheduling data').closest('li')).toHaveTextContent('Not allowed:')
    expect(screen.getByText('Transfer ownership')).toHaveClass('text-muted-foreground')
    if (authMode === 'password') expect(screen.getByTestId('member-management')).not.toBeVisible()
    else expect(screen.queryByTestId('member-management')).not.toBeInTheDocument()
  })
})
