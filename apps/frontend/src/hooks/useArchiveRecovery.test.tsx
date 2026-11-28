import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Role } from '@capacitylens/shared/account/types'
import type { ArchiveRecovery } from '@capacitylens/shared/domain/lifecycle'
import { AuthContext } from '@/auth/authContext'
import { PermissionContext } from '@/auth/permissionContext'
import { useStore } from '@/store/useStore'
import { createTuyauReactQueryClient } from '@tuyau/react-query'
import { invalidateInactiveReads } from '@/api/queryClient'
import { QueryCacheLifecycle } from '@/api/QueryCacheLifecycle'
import { useArchiveRecovery } from './useArchiveRecovery'
import { permissionValue } from '@/test/permissionGrants'
import { makePlanningAccess } from '@/test/planning/planningAccessFixtures'
import { createDeferred } from '@/test/createDeferred'
import { setMasqueradeToken } from '@/api/masqueradeToken'
const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/api/queryClient', async (original) => {
  const actual = await original<typeof import('@/api/queryClient')>()
  return {
    ...actual,
    client: { request },
    api: createTuyauReactQueryClient({ client: { request } as never }),
  }
})
function payload(companyId: string, label: string): ArchiveRecovery {
  return {
    companyId,
    rows: [{ entity: 'clients', id: 'client', label, archived: true, parent: null }],
  }
}
function Probe() {
  const { data, error } = useArchiveRecovery()
  return <div>{error ?? data?.rows.map((row) => row.label).join(',') ?? 'hidden'}</div>
}
function view(cache: QueryClient, role: Role = 'editor', userId: string | null = 'bruce') {
  return (
    <QueryClientProvider client={cache}>
      <AuthContext.Provider
        value={{
          user: userId ? { id: userId } : null,
          refreshAuth: async () => {},
          signOut: async () => {},
        }}
      >
        <PermissionContext.Provider value={permissionValue(role, 'resolved')}>
          <QueryCacheLifecycle cache={cache} />
          <Probe />
        </PermissionContext.Provider>
      </AuthContext.Provider>
    </QueryClientProvider>
  )
}
function company(companyId: string) {
  useStore.setState((state) => ({
    activeCompanyId: companyId,
    planning: {
      ...state.planning,
      context: { identity: 'user', companyId },
      phase: { kind: 'ready', lastWrite: null },
      revision: 0,
      access: makePlanningAccess({
        actorId: 'bruce',
        effectiveActorId: 'bruce',
        role: 'editor',
      }),
    },
  }))
}
beforeEach(() => {
  request.mockReset()
  useStore.setState({ refreshPlanning: async () => true })
  company('a-studio')
})
describe('archive recovery request boundaries', () => {
  it('requests the generated identity route and refreshes after lifecycle changes', async () => {
    request
      .mockResolvedValueOnce({ data: payload('a-studio', 'First') })
      .mockResolvedValueOnce({ data: payload('a-studio', 'Second') })
    const cache = new QueryClient()
    render(view(cache))
    expect(await screen.findByText('First')).toBeInTheDocument()
    expect(request.mock.calls[0]?.[0]).toBe('api.planning_archive.show')
    act(() => void invalidateInactiveReads(cache))
    expect(await screen.findByText('Second')).toBeInTheDocument()
    expect(request.mock.calls.every(([name]) => name === 'api.planning_archive.show')).toBe(true)
  })
  it.each([
    ['the captured view-as-member proof', '1.0123456789abcdef0123456789abcdef'],
    ['an explicit empty proof when none is held', null],
  ])('sends %s with the read', async (_label, token) => {
    request.mockResolvedValue({ data: payload('a-studio', 'First') })
    setMasqueradeToken(token)
    try {
      render(view(new QueryClient()))
      expect(await screen.findByText('First')).toBeInTheDocument()
      expect(request).toHaveBeenCalledWith(
        'api.planning_archive.show',
        expect.objectContaining({ headers: { 'X-Masquerade-Context': token ?? '' } })
      )
    } finally {
      setMasqueradeToken(null)
    }
  })
  it('hides cached A synchronously on A → B → A and aborts obsolete reads', async () => {
    const pending = createDeferred<{ data: ArchiveRecovery }>()
    request
      .mockResolvedValueOnce({ data: payload('a-studio', 'Old A') })
      .mockReturnValueOnce(pending.promise)
      .mockReturnValueOnce(new Promise(() => {}))
    render(view(new QueryClient()))
    expect(await screen.findByText('Old A')).toBeInTheDocument()
    act(() => company('a-loft'))
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    const args = request.mock.calls[1]?.[1] as { signal: AbortSignal }
    const signal = args.signal
    act(() => company('a-studio'))
    expect(screen.getByText('hidden')).toBeInTheDocument()
    await act(async () => pending.resolve({ data: payload('a-loft', 'Late B') }))
    expect(signal.aborted).toBe(true)
    expect(screen.queryByText(/Old A|Late B/)).not.toBeInTheDocument()
  })
  it('discards Owner labels on role and same-company user transitions', async () => {
    request
      .mockResolvedValueOnce({ data: payload('a-studio', 'Owner secret') })
      .mockReturnValue(new Promise(() => {}))
    const cache = new QueryClient()
    useStore.setState((state) => ({
      planning: {
        ...state.planning,
        access: makePlanningAccess({ actorId: 'bruce', effectiveActorId: 'bruce' }),
      },
    }))
    const rendered = render(view(cache, 'owner'))
    expect(await screen.findByText('Owner secret')).toBeInTheDocument()
    rendered.rerender(view(cache, 'admin'))
    expect(screen.getByText('hidden')).toBeInTheDocument()
    rendered.rerender(view(cache, 'owner', 'diana'))
    expect(screen.queryByText('Owner secret')).not.toBeInTheDocument()
  })
  it('does not read while viewing as another member', async () => {
    request.mockResolvedValue({ data: payload('a-studio', 'Hidden while viewing as') })
    useStore.setState((state) => ({
      planning: {
        ...state.planning,
        access: makePlanningAccess({
          actorId: 'bruce',
          effectiveActorId: 'diana',
          role: 'editor',
        }),
      },
    }))
    render(view(new QueryClient()))
    expect(screen.getByText('hidden')).toBeInTheDocument()
    expect(request).not.toHaveBeenCalled()
  })
  it('refuses Viewer reads and surfaces failed reloads without stale success', async () => {
    request
      .mockResolvedValueOnce({ data: payload('a-studio', 'First') })
      .mockRejectedValueOnce(new Error('Archive read failed'))
    const cache = new QueryClient()
    const rendered = render(view(cache, 'viewer'))
    expect(request).not.toHaveBeenCalled()
    rendered.rerender(view(cache))
    expect(await screen.findByText('First')).toBeInTheDocument()
    act(() => void invalidateInactiveReads(cache))
    expect(await screen.findByText('Archive read failed')).toBeInTheDocument()
    expect(screen.queryByText('First')).not.toBeInTheDocument()
  })
  it('aborts a delayed response on sign-out and rejects it after a new projection', async () => {
    const late = createDeferred<{ data: ArchiveRecovery }>()
    request.mockReturnValue(late.promise)
    const cache = new QueryClient()
    const rendered = render(view(cache))
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    const args = request.mock.calls[0]?.[1] as { signal: AbortSignal }
    rendered.rerender(view(cache, 'editor', null))
    expect(screen.getByText('hidden')).toBeInTheDocument()
    await act(async () => late.resolve({ data: payload('a-studio', 'Late identity') }))
    expect(args.signal.aborted).toBe(true)
    expect(screen.queryByText('Late identity')).not.toBeInTheDocument()
    act(() =>
      useStore.setState((state) => ({
        planning: { ...state.planning, phase: { kind: 'loading', lastWrite: null } },
      }))
    )
    rendered.rerender(view(cache))
    expect(screen.getByText('hidden')).toBeInTheDocument()
    expect(request).toHaveBeenCalledTimes(1)
  })
})
