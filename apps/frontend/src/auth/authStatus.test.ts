import { describe, expect, it, vi } from 'vitest'
import { sessionRequests } from '@/account/sessionRequests'
import { getMasqueradeToken, setMasqueradeToken } from '@/api/masqueradeToken'
import { useStore } from '@/store/useStore'
import { fetchAuthStatus } from './fetchAuthStatus'
import { masqueradeApi } from './masqueradeApi'
import { masqueradeModel } from './masqueradeModelInstance'
import { masqueradeGrantFor } from '@/test/permissionGrants'

it.each([true, false, undefined, 'true'])(
  'parses the signed-out reset-email flag %s',
  async (passwordResetEmail) => {
    const status = vi
      .spyOn(masqueradeApi, 'status')
      .mockResolvedValue({ active: false, masqueradeToken: 'idle-context' })
    const request = vi.spyOn(sessionRequests, 'me').mockResolvedValue(
      new Response(JSON.stringify({ passwordResetEmail }), {
        status: 401,
      })
    )
    try {
      expect(await fetchAuthStatus(() => true)).toMatchObject({
        kind: 'signIn',
        passwordResetEmail: passwordResetEmail === true,
      })
    } finally {
      status.mockRestore()
      request.mockRestore()
    }
  }
)

describe('fetchAuthStatus when masquerade status is unreachable', () => {
  it('does not treat a successful /me response as proof that the projection is inactive', async () => {
    const status = vi.spyOn(masqueradeApi, 'status').mockRejectedValue(new TypeError('offline'))
    const request = vi.spyOn(sessionRequests, 'me').mockResolvedValue(
      new Response(
        JSON.stringify({
          user: { id: 'real-user', email: 'real@example.test', name: 'Real User' },
        }),
        { status: 200 }
      )
    )
    try {
      expect(await fetchAuthStatus(() => false)).toMatchObject({ kind: 'error' })
    } finally {
      status.mockRestore()
      request.mockRestore()
    }
  })

  it('uses a live 401 to offer sign-in while masquerade status is unreachable', async () => {
    const status = vi.spyOn(masqueradeApi, 'status').mockRejectedValue(new TypeError('offline'))
    const request = vi
      .spyOn(sessionRequests, 'me')
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 401 }))
    try {
      expect(await fetchAuthStatus(() => false)).toMatchObject({ kind: 'signIn' })
    } finally {
      status.mockRestore()
      request.mockRestore()
    }
  })

  it('does not query /me after a non-transport status failure', async () => {
    const status = vi.spyOn(masqueradeApi, 'status').mockRejectedValue(new Error('status rejected'))
    const request = vi.spyOn(sessionRequests, 'me')
    try {
      expect(await fetchAuthStatus(() => false)).toMatchObject({ kind: 'error' })
      expect(request).not.toHaveBeenCalled()
    } finally {
      status.mockRestore()
      request.mockRestore()
    }
  })
})

describe('fetchAuthStatus masquerade reconciliation', () => {
  it('adopts the idle request proof before querying the authenticated setup boundary', async () => {
    const status = vi.spyOn(masqueradeApi, 'status').mockResolvedValue({
      active: false,
      masqueradeToken: 'idle-context',
    })
    const request = vi.spyOn(sessionRequests, 'me').mockImplementation(async () => {
      expect(getMasqueradeToken()).toBe('idle-context')
      return new Response(JSON.stringify({}), { status: 401 })
    })
    try {
      await expect(fetchAuthStatus(() => true)).resolves.toMatchObject({ kind: 'signIn' })
      expect(status).toHaveBeenCalledOnce()
      expect(request).toHaveBeenCalledOnce()
    } finally {
      status.mockRestore()
      request.mockRestore()
      setMasqueradeToken(null)
    }
  })

  it('routes an inactive auth status through recovery for a locally active projection', async () => {
    const status = vi.spyOn(masqueradeApi, 'status').mockResolvedValue({
      active: false,
      masqueradeToken: 'new-idle-context',
    })
    const request = vi
      .spyOn(sessionRequests, 'me')
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 401 }))
    const restore = vi
      .spyOn(masqueradeModel, 'restoreServerEndedProjection')
      .mockImplementation(() => {})
    useStore.setState({
      activeCompanyId: 'a-studio',
      masquerade: {
        kind: 'active',
        generation: 8,
        state: {
          companyId: 'a-studio',
          targetUserId: 'u-viewer',
          targetName: 'Selina Kyle',
          effectiveRole: 'viewer',
          ...masqueradeGrantFor('viewer'),
          startedAt: '2026-09-01T10:00:00.000Z',
          expiresAt: '2026-09-01T10:15:00.000Z',
          token: 'old-mode-context',
        },
      },
    })
    try {
      await expect(fetchAuthStatus(() => true)).resolves.toMatchObject({ kind: 'signIn' })
      expect(restore).toHaveBeenCalledOnce()
      expect(getMasqueradeToken()).toBe('new-idle-context')
    } finally {
      status.mockRestore()
      request.mockRestore()
      restore.mockRestore()
      masqueradeModel.invalidate()
      setMasqueradeToken(null)
    }
  })

  it('fails closed without adopting an active status whose actor is not a valid user', async () => {
    const status = vi.spyOn(masqueradeApi, 'status').mockResolvedValue({
      active: true,
      companyId: 'a-studio',
      targetUserId: 'u-viewer',
      targetName: 'Selina Kyle',
      effectiveRole: 'viewer',
      ...masqueradeGrantFor('viewer'),
      startedAt: '2026-09-01T10:00:00.000Z',
      expiresAt: '2026-09-01T10:15:00.000Z',
      token: 'mode-token',
      masqueradeToken: 'mode-token',
      actor: { id: '', email: 'real@example.test' },
    })
    const adopt = vi.spyOn(masqueradeModel, 'adoptStatus')
    try {
      await expect(fetchAuthStatus(() => true)).resolves.toMatchObject({ kind: 'error' })
      expect(adopt).not.toHaveBeenCalled()
    } finally {
      status.mockRestore()
      adopt.mockRestore()
    }
  })

  it('ignores an active status read that resolves after local identity invalidation', async () => {
    let resolveStatus!: (status: Awaited<ReturnType<typeof masqueradeApi.status>>) => void
    const status = vi.spyOn(masqueradeApi, 'status').mockReturnValue(
      new Promise((resolve) => {
        resolveStatus = resolve
      })
    )
    const adopt = vi.spyOn(masqueradeModel, 'adoptStatus')
    const activeStatus = {
      active: true as const,
      companyId: 'a-studio',
      targetUserId: 'u-viewer',
      targetName: 'Selina Kyle',
      effectiveRole: 'viewer' as const,
      ...masqueradeGrantFor('viewer'),
      startedAt: '2026-09-01T10:00:00.000Z',
      expiresAt: '2026-09-01T10:15:00.000Z',
      token: 'stale-mode-token',
      masqueradeToken: 'stale-mode-token',
      actor: { id: 'real-user', email: 'real@example.test' },
    }
    try {
      const pending = fetchAuthStatus(() => true)
      await vi.waitFor(() => expect(status).toHaveBeenCalledOnce())
      masqueradeModel.invalidate()
      resolveStatus(activeStatus)

      await expect(pending).resolves.toBeNull()
      expect(adopt).not.toHaveBeenCalled()
      expect(useStore.getState().masquerade).toEqual({ kind: 'inactive' })
      expect(getMasqueradeToken()).toBeNull()
    } finally {
      status.mockRestore()
      adopt.mockRestore()
      masqueradeModel.invalidate()
    }
  })
})
