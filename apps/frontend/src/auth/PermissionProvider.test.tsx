import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PermissionProvider } from './PermissionProvider'
import { AuthContext } from './authContext'
import type { AuthContextValue } from './authContext'
import { useCanEdit, usePermissionStatus, useRole } from './permissionContext'
import { loadPlanningData, makeCompany, makeAppData, resetStoreWithCompany } from '@/test/fixtures'
import { useStore } from '@/store/useStore'
import { useCompanySummaries } from './useCompanySummaries'
import * as companyTransition from './companyTransition'
import type { MasqueradeStatus } from '@capacitylens/shared/domain/masquerade'
import { isRole } from '@capacitylens/shared/account/types'
import { grantFor, masqueradeGrantFor } from '@/test/permissionGrants'
import { createDeferred } from '@/test/createDeferred'

const permissionMocks = vi.hoisted(() => ({
  masqueradeStatus: vi.fn<() => Promise<MasqueradeStatus>>(async () => ({
    active: false,
    masqueradeToken: 'idle',
  })),
}))
vi.mock('./masqueradeApi', () => ({
  masqueradeApi: { status: permissionMocks.masqueradeStatus },
}))

const auth: AuthContextValue = {
  user: { id: 'u1' },
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
      <PermissionProvider>
        <Probe />
      </PermissionProvider>
    </AuthContext.Provider>
  )
}

function SharedDirectoryProvider() {
  useCompanySummaries()
  return (
    <PermissionProvider>
      <Probe />
    </PermissionProvider>
  )
}

function renderSharedDirectoryProvider() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AuthContext.Provider value={auth}>
        <SharedDirectoryProvider />
      </AuthContext.Provider>
    </QueryClientProvider>
  )
}

function companyResponse(id: string, role: string) {
  return new Response(
    JSON.stringify({
      data: [
        {
          id,
          name: id === 'a-studio' ? 'Wayne Enterprises' : 'Stark Industries',
          role,
          ...(isRole(role) ? grantFor(role) : {}),
        },
      ],
    }),
    {
      status: 200,
    }
  )
}

function addSecondCompany() {
  loadPlanningData(
    makeAppData({
      companies: [
        makeCompany({ id: 'acct-test' }),
        makeCompany({ id: 'a-studio', name: 'Wayne Enterprises' }),
      ],
    })
  )
  useStore.getState().setActiveCompany('acct-test')
}

beforeEach(async () => {
  permissionMocks.masqueradeStatus
    .mockReset()
    .mockResolvedValue({ active: false, masqueradeToken: 'idle' })
  await resetStoreWithCompany()
  useStore.setState({ masquerade: { kind: 'inactive' } })
})

afterEach(() => {
  useStore.setState({ masquerade: { kind: 'inactive' } })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('PermissionProvider authenticated lookup posture', () => {
  it('uses the active target role without requesting company membership', async () => {
    useStore.setState({
      activeCompanyId: 'a-studio',
      masquerade: {
        kind: 'active',
        generation: 4,
        state: {
          companyId: 'a-studio',
          targetUserId: 'u-viewer',
          targetName: 'Selina Kyle',
          effectiveRole: 'viewer',
          ...masqueradeGrantFor('viewer'),
          startedAt: '2026-09-01T10:00:00.000Z',
          expiresAt: '2999-09-01T10:15:00.000Z',
          token: 'session-token',
        },
      },
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    renderProvider()

    expect(await screen.findByText('resolved:viewer:read')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(permissionMocks.masqueradeStatus).not.toHaveBeenCalled()
  })

  it('is read-only immediately while role lookup is pending', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {}))
    )
    renderProvider()

    expect(screen.getByText('pending:viewer:read')).toBeInTheDocument()
  })

  it('stays read-only when role lookup fails or returns malformed data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    renderProvider()

    expect(await screen.findByText('unavailable:viewer:read')).toBeInTheDocument()
  })
})

describe('PermissionProvider refresh behavior', () => {
  it('enables editing only after a concrete write-tier role resolves', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              {
                id: useStore.getState().activeCompanyId,
                name: 'Wayne Enterprises',
                role: 'editor',
                ...grantFor('editor'),
              },
            ],
          }),
          { status: 200 }
        )
      )
    )
    renderProvider()

    expect(screen.getByText('pending:viewer:read')).toBeInTheDocument()
    expect(await screen.findByText('resolved:editor:edit')).toBeInTheDocument()
  })
})

describe('PermissionProvider membership invalidation', () => {
  it('starts the directory read only after status resolves and adopts status before publishing the role', async () => {
    let resolveStatus!: (status: { active: false; masqueradeToken: string }) => void
    permissionMocks.masqueradeStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStatus = resolve
        })
    )
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: useStore.getState().activeCompanyId,
              name: 'Wayne Enterprises',
              role: 'owner',
              ...grantFor('owner'),
            },
          ],
        }),
        { status: 200 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    const adoptStatus = vi.spyOn(companyTransition, 'adoptMasqueradeStatus')

    renderProvider()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByText('pending:viewer:read')).toBeInTheDocument()
    await waitFor(() => expect(permissionMocks.masqueradeStatus).toHaveBeenCalledOnce())
    resolveStatus({ active: false, masqueradeToken: 'idle' })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(await screen.findByText('resolved:owner:edit')).toBeInTheDocument()

    // The role is published from the directory read, so adopting status must precede that read.
    const directoryReadOrder = fetchMock.mock.invocationCallOrder[0]
    if (directoryReadOrder === undefined) throw new Error('directory read was not recorded')
    expect(adoptStatus.mock.invocationCallOrder[0]).toBeLessThan(directoryReadOrder)
  })
})

describe('PermissionProvider membership generation', () => {
  it('re-resolves the active role when a membership mutation invalidates its projections', async () => {
    let role: 'owner' | 'admin' = 'owner'
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: useStore.getState().activeCompanyId,
                name: 'Wayne Enterprises',
                role,
                ...grantFor(role),
              },
            ],
          }),
          { status: 200 }
        )
    )
    vi.stubGlobal('fetch', fetchMock)
    renderProvider()

    expect(await screen.findByText('resolved:owner:edit')).toBeInTheDocument()
    role = 'admin'
    act(() => useStore.getState().invalidateMemberships())

    expect(screen.getByText('pending:viewer:read')).toBeInTheDocument()
    expect(await screen.findByText('resolved:admin:edit')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('shares one company-directory read per membership generation with the shell hook', async () => {
    let role: 'owner' | 'admin' = 'owner'
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: useStore.getState().activeCompanyId,
                name: 'Wayne Enterprises',
                role,
                ...grantFor(role),
              },
            ],
          }),
          { status: 200 }
        )
    )
    vi.stubGlobal('fetch', fetchMock)
    renderSharedDirectoryProvider()

    expect(await screen.findByText('resolved:owner:edit')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    role = 'admin'
    act(() => useStore.getState().invalidateMemberships())

    expect(screen.getByText('pending:viewer:read')).toBeInTheDocument()
    expect(await screen.findByText('resolved:admin:edit')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('PermissionProvider company-switch safety', () => {
  it('fails closed in context immediately after switching from a company the caller owns', async () => {
    addSecondCompany()
    const b = createDeferred<Response>()
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(companyResponse('acct-test', 'owner'))
        .mockImplementationOnce(() => b.promise)
    )
    renderProvider()

    expect(await screen.findByText('resolved:owner:edit')).toBeInTheDocument()
    act(() => useStore.getState().setActiveCompany('a-studio'))

    expect(screen.getByText('pending:viewer:read')).toBeInTheDocument()

    await act(async () => b.resolve(companyResponse('a-studio', 'editor')))
    expect(await screen.findByText('resolved:editor:edit')).toBeInTheDocument()
  })

  it("does not adopt an old company's delayed masquerade status after a switch", async () => {
    addSecondCompany()
    const aStatus = createDeferred<{ active: false; masqueradeToken: string }>()
    permissionMocks.masqueradeStatus
      .mockImplementationOnce(() => aStatus.promise)
      .mockResolvedValueOnce({ active: false, masqueradeToken: 'idle' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(companyResponse('a-studio', 'editor')))
    const adoptStatus = vi.spyOn(companyTransition, 'adoptMasqueradeStatus')
    renderProvider()

    await waitFor(() => expect(permissionMocks.masqueradeStatus).toHaveBeenCalledOnce())
    act(() => useStore.getState().setActiveCompany('a-studio'))
    expect(screen.getByText('pending:viewer:read')).toBeInTheDocument()
    expect(await screen.findByText('resolved:editor:edit')).toBeInTheDocument()

    await act(async () => aStatus.resolve({ active: false, masqueradeToken: 'idle' }))
    expect(adoptStatus).toHaveBeenCalledTimes(1)
    expect(screen.getByText('resolved:editor:edit')).toBeInTheDocument()
  })

  it('ignores a delayed active status after a local masquerade model transition', async () => {
    await resetStoreWithCompany('a-studio')
    let resolveStatus!: (status: MasqueradeStatus) => void
    permissionMocks.masqueradeStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStatus = resolve
        })
    )
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { masqueradeModel } = await import('./masqueradeModelInstance')
    const inactiveProjection = useStore.getState().masquerade
    const adoptStatus = vi.spyOn(companyTransition, 'adoptMasqueradeStatus')
    renderProvider()

    await waitFor(() => expect(permissionMocks.masqueradeStatus).toHaveBeenCalledOnce())
    act(() => {
      masqueradeModel.invalidate()
      useStore.setState({ masquerade: inactiveProjection })
    })
    await act(async () =>
      resolveStatus({
        active: true,
        companyId: 'a-studio',
        targetUserId: 'u-viewer',
        targetName: 'Selina Kyle',
        effectiveRole: 'viewer',
        ...masqueradeGrantFor('viewer'),
        startedAt: '2026-09-01T10:00:00.000Z',
        expiresAt: '2026-09-01T10:15:00.000Z',
        token: 'stale-mode-token',
        masqueradeToken: 'stale-mode-token',
      })
    )

    expect(adoptStatus).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(useStore.getState().masquerade).toBe(inactiveProjection)
  })
})

describe('PermissionProvider stale directory safety', () => {
  it("keeps B authoritative when A's delayed directory response resolves later", async () => {
    addSecondCompany()
    const a = createDeferred<Response>()
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => a.promise)
      .mockResolvedValueOnce(companyResponse('a-studio', 'admin'))
    vi.stubGlobal('fetch', fetchMock)
    renderProvider()

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    act(() => useStore.getState().setActiveCompany('a-studio'))
    expect(await screen.findByText('resolved:admin:edit')).toBeInTheDocument()
    await act(async () => a.resolve(companyResponse('acct-test', 'owner')))

    expect(screen.getByText('resolved:admin:edit')).toBeInTheDocument()
  })

  it("does not let a stale A directory rejection overwrite B's role", async () => {
    addSecondCompany()
    const a = createDeferred<Response>()
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => a.promise)
      .mockResolvedValueOnce(companyResponse('a-studio', 'owner'))
    vi.stubGlobal('fetch', fetchMock)
    renderProvider()

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    act(() => useStore.getState().setActiveCompany('a-studio'))
    expect(await screen.findByText('resolved:owner:edit')).toBeInTheDocument()
    await act(async () => a.reject(new Error('A timed out')))

    expect(screen.getByText('resolved:owner:edit')).toBeInTheDocument()
  })
})

describe('PermissionProvider fail-closed responses', () => {
  it('fails closed for an absent or malformed active membership and clears only after a complete list proves absence', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(companyResponse('other', 'owner'))
        .mockResolvedValueOnce(companyResponse('acct-test', 'unknown-role'))
    )
    renderProvider()

    await waitFor(() => expect(useStore.getState().activeCompanyId).toBeNull())
    expect(screen.getByText('not-applicable:none:read')).toBeInTheDocument()

    // Simulate a stale active company selection after the complete directory proved the
    // authenticated identity has no membership there.
    act(() => useStore.setState({ activeCompanyId: 'acct-test' }))
    expect(screen.getByText('pending:viewer:read')).toBeInTheDocument()
    expect(await screen.findByText('unavailable:viewer:read')).toBeInTheDocument()
    expect(useStore.getState().activeCompanyId).toBe('acct-test')
  })

  it('publishes unavailable with no keys for a directory row without a grant', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              {
                id: useStore.getState().activeCompanyId,
                name: 'Wayne Enterprises',
                role: 'owner',
              },
            ],
          }),
          { status: 200 }
        )
      )
    )
    renderProvider()

    expect(await screen.findByText('unavailable:viewer:read')).toBeInTheDocument()
  })

  it('does not request permissions until an active company is selected', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    useStore.setState({ activeCompanyId: null })

    renderProvider()
    expect(screen.getByText('not-applicable:none:read')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(permissionMocks.masqueradeStatus).not.toHaveBeenCalled()
  })
})
