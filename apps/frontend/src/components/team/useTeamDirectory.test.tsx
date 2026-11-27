import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { teamAccessApi } from '@/account/teamAccessApi'
import type { TeamDirectory } from '@/account/teamAccessApi'
import { AuthContext } from '@/auth/authContext'
import { DEFAULT_COMPANY_ID, resetStoreWithCompany } from '@/test/fixtures'
import { holdCalls } from '@/test/holdCalls'
import { makeAuthValue } from './MembersSectionTestKit'
import { useTeamDirectory } from './useTeamDirectory'

type MembersRead = Awaited<ReturnType<typeof teamAccessApi.listMembers>>

function makeDirectory(
  resourceLink: { resourceId: string; revision: string } | null
): TeamDirectory {
  return {
    signInTrackingEnabled: false,
    resourceCandidates: [{ resourceId: 'r-bruce', label: 'Bruce Wayne' }],
    members: [
      {
        userId: 'ed',
        role: 'editor',
        status: 'active',
        manage: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        name: 'Clark Kent',
        email: 'ed@x.io',
        signInConfirmed: null,
        isSelf: false,
        resourceLink: resourceLink
          ? { resourceName: null, resourceStatus: 'active', ...resourceLink }
          : null,
      },
    ],
  }
}

// Resolves the first members read at once and holds every later read until the test settles it.
function controlMemberReads() {
  const reads = holdCalls<MembersRead>()
  const listMembers = vi
    .spyOn(teamAccessApi, 'listMembers')
    .mockResolvedValueOnce({ kind: 'ok', status: 200, value: makeDirectory(null) })
    .mockImplementation(() => new Promise((resolve) => reads.calls.push(resolve)))
  vi.spyOn(teamAccessApi, 'listInvitations').mockResolvedValue({
    kind: 'ok',
    status: 200,
    value: [],
  })
  return { listMembers, settleNext: reads.settleNext }
}

function renderDirectory(
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
) {
  const fail = vi.fn()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={makeAuthValue()}>{children}</AuthContext.Provider>
    </QueryClientProvider>
  )
  return renderHook(
    () => useTeamDirectory({ enabled: true, activeCompanyId: DEFAULT_COMPANY_ID, fail }),
    { wrapper }
  )
}

beforeEach(async () => {
  await resetStoreWithCompany()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('useTeamDirectory read generations', () => {
  it('accepts a requested generation only from its successful members read', async () => {
    const reads = controlMemberReads()
    const { result } = renderDirectory()
    await waitFor(() => expect(result.current.directory.kind).toBe('ready'))
    const accepted = result.current.acceptedReadGeneration

    let failedGeneration = 0
    act(() => {
      failedGeneration = result.current.reload()
    })
    expect(failedGeneration).toBeGreaterThan(accepted)
    await reads.settleNext({ kind: 'rejected', status: 500, message: null })
    await waitFor(() => expect(result.current.directory.kind).toBe('error'))
    expect(result.current.acceptedReadGeneration).toBe(accepted)

    let retryGeneration = 0
    act(() => {
      retryGeneration = result.current.reload()
    })
    expect(retryGeneration).toBeGreaterThan(failedGeneration)
    const linked = { resourceId: 'r-bruce', revision: 'rev-2' }
    await reads.settleNext({ kind: 'ok', status: 200, value: makeDirectory(linked) })
    await waitFor(() => expect(result.current.acceptedReadGeneration).toBe(retryGeneration))
    expect(result.current.directory).toMatchObject({
      kind: 'ready',
      snapshot: { members: [{ resourceLink: linked }] },
    })
  })

  it('keeps the accepted generation when another snapshot replacement arrives first', async () => {
    const reads = controlMemberReads()
    const { result } = renderDirectory()
    await waitFor(() => expect(result.current.directory.kind).toBe('ready'))
    const accepted = result.current.acceptedReadGeneration

    let requested = 0
    act(() => {
      requested = result.current.reload()
    })
    const replaced = makeDirectory({ resourceId: 'r-bruce', revision: 'rev-2' })
    act(() => result.current.replaceAuthorizedDirectory(replaced, []))
    // The query cache notifies its observers on the next task.
    await waitFor(() =>
      expect(result.current.directory).toMatchObject({ snapshot: { members: replaced.members } })
    )
    expect(result.current.acceptedReadGeneration).toBe(accepted)

    await reads.settleNext({ kind: 'ok', status: 200, value: replaced })
    await waitFor(() => expect(result.current.acceptedReadGeneration).toBe(requested))
  })

  // A revisit within the cache lifetime must not accept a cached read from an earlier visit.
  it('requests a generation that a remount cannot satisfy from the shared query cache', async () => {
    const reads = controlMemberReads()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const firstVisit = renderDirectory(queryClient)
    await waitFor(() => expect(firstVisit.result.current.directory.kind).toBe('ready'))
    act(() => {
      firstVisit.result.current.reload()
    })
    await reads.settleNext({ kind: 'ok', status: 200, value: makeDirectory(null) })
    firstVisit.unmount()

    const secondVisit = renderDirectory(queryClient)
    await waitFor(() => expect(secondVisit.result.current.directory.kind).toBe('ready'))
    const callsBeforeReload = reads.listMembers.mock.calls.length
    let requested = 0
    act(() => {
      requested = secondVisit.result.current.reload()
    })
    await waitFor(() =>
      expect(reads.listMembers.mock.calls.length).toBeGreaterThan(callsBeforeReload)
    )
    expect(secondVisit.result.current.acceptedReadGeneration).toBeLessThan(requested)

    const linked = { resourceId: 'r-bruce', revision: 'rev-2' }
    await reads.settleNext({ kind: 'ok', status: 200, value: makeDirectory(linked) })
    await reads.settleNext({ kind: 'ok', status: 200, value: makeDirectory(linked) })
    await waitFor(() => expect(secondVisit.result.current.acceptedReadGeneration).toBe(requested))
  })
})
