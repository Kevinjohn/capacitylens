import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AuthProvider } from '@/auth/AuthProvider'
import { useAuth } from '@/auth/authContext'
import { queryClient } from '@/api/queryClient'
import { AUTH_INVALIDATION_STORAGE_KEY } from '@/auth/signOut'
import { useStore } from '@/store/useStore'
import { resetStoreWithCompany, jsonResponse, requireValue } from '@/test/fixtures'
import { MembersSection } from './MembersSection'
import { fakeApiFetch, mockApi, makeRawMember } from './MembersSectionTestKit'
import { OwnerPermissions } from '@/test/ownerPermissions'
import { createDeferred } from '@/test/createDeferred'
function CurrentUser() {
  return <span data-testid="user">{useAuth().user?.id}</span>
}
let currentUserId: string
let holdDirectory: Promise<Response> | null
let heldMutation: Promise<Response> | null
let directoryReads: number
let invitationReads: number
let writes: number
beforeEach(async () => {
  queryClient.clear()
  await resetStoreWithCompany()
  currentUserId = 'bruce'
  holdDirectory = null
  heldMutation = null
  directoryReads = 0
  invitationReads = 0
  writes = 0
  const base = mockApi([], {
    'GET /members': () => {
      directoryReads += 1
      if (holdDirectory) return holdDirectory
      return directory()
    },
    'GET /invitations': () =>
      jsonResponse({
        data: {
          invites: [
            {
              id: 1,
              role: 'editor',
              preauthEmail: 'clark@wayne.test',
              expiresAt: '2099-01-01T00:00:00.000Z',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
      }),
    'POST /api/v1/invitations': () => {
      writes += 1
      return heldMutation ?? jsonResponse({ data: { emailed: true } }, 201)
    },
    'POST /resend': () => {
      writes += 1
      return heldMutation ?? jsonResponse({ data: { emailed: true } })
    },
    'GET /api/v1/auth/me': () =>
      jsonResponse({
        data: {
          user: { id: currentUserId, email: `${currentUserId}@wayne.test` },
          emailVerified: true,
          membershipRequired: false,
          admission: { admitted: true, requirements: {} },
        },
      }),
  })
  vi.stubGlobal(
    'fetch',
    fakeApiFetch((url, request) => {
      if (url.endsWith('/invitations') && request.method === 'GET') {
        invitationReads += 1
      }
      if (url.includes('/api/v1/masquerade')) {
        return jsonResponse({ data: { active: false, masqueradeToken: 'idle' } })
      }
      return base(url, request)
    })
  )
})
afterEach(() => {
  queryClient.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
function directory() {
  return jsonResponse({
    data: {
      members: [
        makeRawMember({ userId: currentUserId, role: 'owner', isSelf: true }),
        makeRawMember({ userId: 'clark', role: 'editor', name: 'Clark Kent' }),
      ],
      resourceCandidates: [],
      signInTrackingEnabled: false,
    },
  })
}
function renderMembers() {
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <CurrentUser />
        <OwnerPermissions>
          <MembersSection />
        </OwnerPermissions>
      </AuthProvider>
    </QueryClientProvider>
  )
}
async function refreshed(nextUserId: string) {
  currentUserId = nextUserId
  fireEvent.focus(window)
  await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent(nextUserId))
}
it.each(['create', 'resend'] as const)(
  'drops old-user %s feedback and reload effects after a real same-company auth refresh',
  async (action) => {
    renderMembers()
    await screen.findByTestId('invite-open')
    const held = createDeferred<Response>()
    heldMutation = held.promise
    try {
      if (action === 'create') {
        fireEvent.click(screen.getByTestId('invite-open'))
        fireEvent.change(screen.getByRole('textbox', { name: /email/i }), {
          target: { value: 'selina@wayne.test' },
        })
        fireEvent.click(screen.getByTestId('invite-submit'))
      } else fireEvent.click(await screen.findByTestId('invite-resend'))
      await waitFor(() => expect(writes).toBe(1))
      await refreshed('diana')
      await screen.findByTestId('invite-open')
      fireEvent.click(screen.getByTestId('invite-open'))
      fireEvent.change(screen.getByRole('textbox', { name: /email/i }), {
        target: { value: 'barbara@wayne.test' },
      })
      const reads = directoryReads
      const invitesBefore = invitationReads
      useStore.getState().setNotice('Current user notice')
      await act(async () =>
        held.resolve(jsonResponse({ data: { emailed: true } }, action === 'create' ? 201 : 200))
      )
      expect(useStore.getState().notice?.message).toBe('Current user notice')
      expect(screen.getByRole('textbox', { name: /email/i })).toHaveValue('barbara@wayne.test')
      expect(directoryReads).toBe(reads)
      expect(invitationReads).toBe(invitesBefore)
      expect(writes).toBe(1)
    } finally {
      await act(async () => held.resolve(jsonResponse({ data: { emailed: true } })))
      heldMutation = null
    }
  }
)
it.each(
  (['different user', 'same user', 'observed sign-out'] as const).flatMap((kind) =>
    (['role', 'confirmation'] as const).map((intent) => ({ kind, intent }))
  )
)('binds retained $intent intent across $kind refresh', async ({ kind, intent }) => {
  renderMembers()
  const rows = await screen.findAllByTestId('member-row')
  const row = requireValue(
    rows.find((row) => row.textContent.includes('clark@x.io')),
    'Clark member row'
  )
  if (intent === 'role') fireEvent.click(within(row).getByTestId('member-edit'))
  else {
    fireEvent.click(within(row).getByTestId('member-menu'))
    fireEvent.click(await screen.findByTestId('member-suspend'))
  }
  const dialogRole = intent === 'role' ? 'dialog' : 'alertdialog'
  expect(await screen.findByRole(dialogRole)).toHaveTextContent('Clark Kent')
  const held = createDeferred<Response>()
  holdDirectory = held.promise
  try {
    const companyId = useStore.getState().activeCompanyId
    if (kind === 'observed sign-out') {
      fireEvent(
        window,
        new StorageEvent('storage', { key: AUTH_INVALIDATION_STORAGE_KEY, newValue: 'changed' })
      )
      await screen.findByTestId('user')
      await act(async () => {
        await resetStoreWithCompany(companyId ?? undefined)
      })
    } else await refreshed(kind === 'same user' ? 'bruce' : 'diana')
    holdDirectory = null
    await act(async () => held.resolve(directory()))
    await screen.findAllByTestId('member-row')
    if (kind === 'same user') {
      expect(screen.getByRole(dialogRole)).toHaveTextContent('Clark Kent')
    } else expect(screen.queryByRole(dialogRole)).not.toBeInTheDocument()
    expect(writes).toBe(0)
  } finally {
    holdDirectory = null
    await act(async () => held.resolve(directory()))
  }
})
