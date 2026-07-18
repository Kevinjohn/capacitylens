import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const listSessions = vi.fn()
const changePassword = vi.fn()
const revokeOwnSession = vi.fn()
vi.mock('../../auth/authClient', () => ({
  authClient: {
    changePassword: (...args: unknown[]) => changePassword(...args),
  },
}))
vi.mock('../../account/accountClient', () => ({
  accountCommandOutcomeUnknown: async (response: Response) => {
    if (response.status >= 500) return true
    if (response.status !== 409) return false
    const body = await response.clone().json().catch(() => null) as { code?: unknown } | null
    return body?.code === 'COMMAND_IN_PROGRESS'
  },
  accountClient: {
    listSessions: (...args: unknown[]) => listSessions(...args),
    revokeOwnSession: (...args: unknown[]) => revokeOwnSession(...args),
  },
}))

import { SecuritySection } from './SecuritySection'

const SESSION = {
  id: 'opaque-session-handle',
  createdAt: '2026-07-14T12:00:00.000Z',
  expiresAt: '2026-07-15T00:00:00.000Z',
  current: false,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  // Each invocation needs a fresh Response because response bodies are single-use.
  listSessions.mockReset().mockImplementation(() => Promise.resolve(jsonResponse([SESSION])))
  changePassword.mockReset()
  revokeOwnSession.mockReset()
})

describe('SecuritySection', () => {
  it('lists active sessions without rendering their bearer tokens and revokes the selected session', async () => {
    revokeOwnSession.mockResolvedValue(new Response(null, { status: 204 }))
    render(<SecuritySection />)
    expect(await screen.findByText('Signed-in session')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(SESSION.id)

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(revokeOwnSession).toHaveBeenCalledWith(SESSION.id))
    expect(await screen.findByRole('status')).toHaveTextContent('Session revoked.')
  })

  it('changes a password only with matching policy-compliant values and revokes other sessions', async () => {
    changePassword.mockResolvedValue({ data: { status: true }, error: null })
    render(<SecuritySection />)
    await screen.findByText('Signed-in session')
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'current-password' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a-strong-new-password' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'a-strong-new-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))

    await waitFor(() => expect(changePassword).toHaveBeenCalledWith({
      currentPassword: 'current-password',
      newPassword: 'a-strong-new-password',
      revokeOtherSessions: true,
    }))
    expect(await screen.findByRole('status')).toHaveTextContent('Other sessions were revoked.')
  })

  it('reloads through the authentication wall when the current session is revoked', async () => {
    const realLocation = window.location
    const reload = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...realLocation, reload },
    })
    listSessions.mockResolvedValue(jsonResponse([{ ...SESSION, current: true }]))
    revokeOwnSession.mockResolvedValue(new Response(null, { status: 204 }))
    try {
      render(<SecuritySection />)
      await screen.findByText('Current session')
      fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
      await waitFor(() => expect(reload).toHaveBeenCalledOnce())
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
    }
  })

  it('reloads through the authentication wall when current-session revocation has an unknown outcome', async () => {
    const realLocation = window.location
    const reload = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...realLocation, reload },
    })
    listSessions.mockResolvedValue(jsonResponse([{ ...SESSION, current: true }]))
    revokeOwnSession.mockRejectedValueOnce(new TypeError('network failed'))
    try {
      render(<SecuritySection />)
      await screen.findByText('Current session')
      fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
      await waitFor(() => expect(reload).toHaveBeenCalledOnce())
      expect(listSessions).toHaveBeenCalledTimes(1)
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
    }
  })

  it('rejects mismatched new passwords without contacting the authentication service', async () => {
    render(<SecuritySection />)
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'current-password' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a-strong-new-password' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'a-different-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('do not match')
    expect(changePassword).not.toHaveBeenCalled()
  })

  it('surfaces session-list failures instead of silently presenting an empty device list', async () => {
    listSessions.mockResolvedValue(jsonResponse({ error: 'Sessions are temporarily unavailable.' }, 503))
    render(<SecuritySection />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Active sessions could not be loaded.')
  })

  it('surfaces password and session-revocation failures without reporting success', async () => {
    changePassword.mockResolvedValue({ data: null, error: { message: 'Current password is incorrect.' } })
    revokeOwnSession.mockResolvedValue(jsonResponse({ error: 'That session no longer exists.' }, 404))
    render(<SecuritySection />)
    await screen.findByText('Signed-in session')

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'wrong-current-password' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a-strong-new-password' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'a-strong-new-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Current password is incorrect.')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The session could not be revoked.')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('reconciles the session list after a transport-level revoke failure', async () => {
    revokeOwnSession.mockRejectedValueOnce(new TypeError('network failed'))
    render(<SecuritySection />)
    await screen.findByText('Signed-in session')

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))

    await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'The revoke request had an unknown outcome. Sessions were refreshed',
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
