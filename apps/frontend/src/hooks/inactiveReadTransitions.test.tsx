import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Role } from '@capacitylens/shared/account/types'
import { createEmptyAppData } from '@capacitylens/shared/types/entities'
import { QueryCacheLifecycle } from '@/api/QueryCacheLifecycle'
import { AuthContext } from '@/auth/authContext'
import { PermissionContext } from '@/auth/permissionContext'
import { useStore } from '@/store/useStore'
import { makeClient, makeCompany } from '@/test/fixtures'
import { permissionValue } from '@/test/permissionGrants'
import { makePlanningAccess } from '@/test/planning/planningAccessFixtures'
import { useArchiveRecovery } from './useArchiveRecovery'
import { useInactiveCompanyData } from './useInactiveCompanyData'

// The scoped query key and QueryCacheLifecycle are the only fences between one company's, one
// viewed-as member's or one role's inactive rows and another's. Every row carries the server
// version that produced it, so a row served from an earlier visit is recognisable as stale.

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/api/queryClient', async (original) => ({
  ...(await original<typeof import('@/api/queryClient')>()),
  client: { request },
}))

let version = 1
let seen: string[] = []

function Probe() {
  const archive = useArchiveRecovery()
  const inactive = useInactiveCompanyData()
  const text = `${archive.data?.rows[0]?.label ?? archive.error ?? '-'}|${inactive.data?.clients.find((c) => c.archivedAt)?.name ?? '-'}`
  seen.push(text)
  return <div data-testid="rows">{text}</div>
}

function view(cache: QueryClient, role: Role, userId: string | null = 'bruce') {
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

function project(companyId: string, effectiveActorId = 'bruce') {
  useStore.setState((state) => ({
    activeCompanyId: companyId,
    planning: {
      ...state.planning,
      context: { identity: 'user', companyId },
      phase: { kind: 'ready', lastWrite: null },
      revision: 0,
      access: makePlanningAccess({ actorId: 'bruce', effectiveActorId, role: 'admin' }),
    },
  }))
}

const label = (companyId: string) => `${companyId}:v${version}`
const text = () => screen.getByTestId('rows').textContent
const noStaleRow = () => expect(seen.filter((entry) => entry.includes(':v1'))).toEqual([])
/** Moves the server on and forgets what rendered so far: only what follows the transition counts. */
function serverMoves() {
  version = 2
  seen = []
}

beforeEach(() => {
  version = 1
  seen = []
  request.mockReset()
  request.mockImplementation(async (_name: string, args: { params: { companyId: string } }) => ({
    data: {
      companyId: args.params.companyId,
      rows: [
        {
          entity: 'clients',
          id: 'client',
          label: label(args.params.companyId),
          archived: true,
          parent: null,
        },
      ],
    },
  }))
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input)
      const companyId = new URL(url, 'http://localhost').searchParams.get('companyId') ?? ''
      return Response.json({
        data: {
          ...createEmptyAppData(),
          companies: [makeCompany({ id: companyId })],
          clients: [
            makeClient({
              id: `client-${companyId}`,
              companyId,
              name: label(companyId),
              archivedAt: '2026-01-01T00:00:00.000Z',
            }),
          ],
        },
      })
    })
  )
  useStore.setState({ masquerade: { kind: 'inactive' }, refreshPlanning: async () => true })
  project('a-studio')
})

afterEach(() => vi.unstubAllGlobals())

describe('inactive reads across identity and access transitions', () => {
  it('never renders a company visited earlier when switching A to B and back to A', async () => {
    const cache = new QueryClient()
    render(view(cache, 'admin'))
    await waitFor(() => expect(text()).toBe('a-studio:v1|a-studio:v1'))
    serverMoves()
    act(() => project('a-loft'))
    await waitFor(() => expect(text()).toBe('a-loft:v2|a-loft:v2'))
    act(() => project('a-studio'))
    await waitFor(() => expect(text()).toBe('a-studio:v2|a-studio:v2'))
    noStaleRow()
  })

  it('never renders pre-view-as rows when view-as starts and stops', async () => {
    const cache = new QueryClient()
    const rendered = render(view(cache, 'admin'))
    await waitFor(() => expect(text()).toBe('a-studio:v1|a-studio:v1'))
    serverMoves()
    act(() => {
      useStore.setState({
        masquerade: {
          kind: 'starting',
          pending: { companyId: 'a-studio', targetUserId: 'diana' },
          generation: 1,
        },
      })
      project('a-studio', 'diana')
    })
    rendered.rerender(view(cache, 'viewer'))
    expect(text()).toBe('-|-')
    act(() => {
      useStore.setState({ masquerade: { kind: 'inactive' } })
      project('a-studio')
    })
    rendered.rerender(view(cache, 'admin'))
    await waitFor(() => expect(text()).toBe('a-studio:v2|a-studio:v2'))
    noStaleRow()
  })

  it('hides rows at once when access is lost by demotion or sign-out, and never replays them', async () => {
    const cache = new QueryClient()
    const rendered = render(view(cache, 'admin'))
    await waitFor(() => expect(text()).toBe('a-studio:v1|a-studio:v1'))
    serverMoves()
    rendered.rerender(view(cache, 'viewer'))
    expect(text()).toBe('-|-')
    rendered.rerender(view(cache, 'admin', null))
    expect(text()).toBe('-|-')
    rendered.rerender(view(cache, 'admin', 'diana'))
    expect(text()).toBe('-|-')
    noStaleRow()
  })
})
