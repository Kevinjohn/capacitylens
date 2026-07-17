import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { PermissionProvider } from './PermissionProvider'
import { AuthContext, type AuthContextValue } from './authContext'
import { useCanEdit, usePermissionStatus, useRole } from './permissionContext'
import { resetStoreWithAccount } from '../test/fixtures'
import { useStore } from '../store/useStore'

const auth: AuthContextValue = {
  authMode: 'password',
  user: { id: 'u1' },
  canCreateAccount: false,
  multiAccount: false,
  refreshAuth: async () => {},
  signOut: async () => {},
}

function Probe() {
  const role = useRole()
  const status = usePermissionStatus()
  const editable = useCanEdit()
  return <div>{`${status}:${role ?? 'none'}:${editable ? 'edit' : 'read'}`}</div>
}

function renderProvider() {
  return render(
    <AuthContext.Provider value={auth}>
      <PermissionProvider><Probe /></PermissionProvider>
    </AuthContext.Provider>,
  )
}

beforeEach(() => {
  resetStoreWithAccount()
  vi.stubEnv('VITE_CAPACITYLENS_DEMO', '')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('PermissionProvider authenticated lookup posture', () => {
  it('is read-only immediately while role lookup is pending', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    renderProvider()

    expect(screen.getByText('pending:viewer:read')).toBeInTheDocument()
    await waitFor(() => expect(useStore.getState().activeRole).toBe('viewer'))
  })

  it('stays read-only when role lookup fails or returns malformed data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    renderProvider()

    await waitFor(() => expect(useStore.getState().activeRole).toBe('viewer'))
    expect(screen.getByText('unavailable:viewer:read')).toBeInTheDocument()
  })

  it('enables editing only after a concrete write-tier role resolves', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ id: useStore.getState().activeAccountId, role: 'editor' }]), { status: 200 }),
    ))
    renderProvider()

    expect(screen.getByText('pending:viewer:read')).toBeInTheDocument()
    expect(await screen.findByText('resolved:editor:edit')).toBeInTheDocument()
    expect(useStore.getState().activeRole).toBe('editor')
  })

  it('re-resolves the active role when a membership mutation invalidates its projections', async () => {
    let role = 'owner'
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify([{ id: useStore.getState().activeAccountId, role }]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    renderProvider()

    expect(await screen.findByText('resolved:owner:edit')).toBeInTheDocument()
    role = 'admin'
    act(() => useStore.getState().invalidateMemberships())

    expect(screen.getByText('pending:viewer:read')).toBeInTheDocument()
    expect(await screen.findByText('resolved:admin:edit')).toBeInTheDocument()
    expect(useStore.getState().activeRole).toBe('admin')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
