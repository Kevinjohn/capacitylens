import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { PermissionProvider } from './PermissionProvider'
import { AuthContext, type AuthContextValue } from './authContext'
import { useCanEdit, useRole } from './permissionContext'
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
  const editable = useCanEdit()
  return <div>{`${role ?? 'none'}:${editable ? 'edit' : 'read'}`}</div>
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

    expect(screen.getByText('viewer:read')).toBeInTheDocument()
    await waitFor(() => expect(useStore.getState().activeRole).toBe('viewer'))
  })

  it('stays read-only when role lookup fails or returns malformed data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    renderProvider()

    await waitFor(() => expect(useStore.getState().activeRole).toBe('viewer'))
    expect(screen.getByText('viewer:read')).toBeInTheDocument()
  })

  it('enables editing only after a concrete write-tier role resolves', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ id: useStore.getState().activeAccountId, role: 'editor' }]), { status: 200 }),
    ))
    renderProvider()

    expect(screen.getByText('viewer:read')).toBeInTheDocument()
    expect(await screen.findByText('editor:edit')).toBeInTheDocument()
    expect(useStore.getState().activeRole).toBe('editor')
  })
})
