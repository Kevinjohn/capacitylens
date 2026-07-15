import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const listSessions = vi.fn()
const changePassword = vi.fn()
const revokeSession = vi.fn()
vi.mock('../../auth/authClient', () => ({
  authClient: {
    listSessions: (...args: unknown[]) => listSessions(...args),
    changePassword: (...args: unknown[]) => changePassword(...args),
    revokeSession: (...args: unknown[]) => revokeSession(...args),
  },
}))

import { SecuritySection } from './SecuritySection'

const SESSION = {
  token: 'session-token-not-rendered',
  createdAt: new Date('2026-07-14T12:00:00.000Z'),
  expiresAt: new Date('2026-07-15T00:00:00.000Z'),
  ipAddress: '192.0.2.10',
  userAgent: 'Test browser',
}

beforeEach(() => {
  listSessions.mockReset().mockResolvedValue({ data: [SESSION], error: null })
  changePassword.mockReset()
  revokeSession.mockReset()
})

describe('SecuritySection', () => {
  it('lists active sessions without rendering their bearer tokens and revokes the selected session', async () => {
    revokeSession.mockResolvedValue({ data: { status: true }, error: null })
    render(<SecuritySection />)
    expect(await screen.findByText('Test browser')).toBeInTheDocument()
    expect(screen.getByText(/192\.0\.2\.10/)).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(SESSION.token)

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(revokeSession).toHaveBeenCalledWith({ token: SESSION.token }))
    expect(await screen.findByRole('status')).toHaveTextContent('Session revoked.')
  })

  it('changes a password only with matching policy-compliant values and revokes other sessions', async () => {
    changePassword.mockResolvedValue({ data: { status: true }, error: null })
    render(<SecuritySection />)
    await screen.findByText('Test browser')
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
    listSessions.mockResolvedValue({ data: null, error: { message: 'Sessions are temporarily unavailable.' } })
    render(<SecuritySection />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Sessions are temporarily unavailable.')
  })

  it('surfaces password and session-revocation failures without reporting success', async () => {
    changePassword.mockResolvedValue({ data: null, error: { message: 'Current password is incorrect.' } })
    revokeSession.mockResolvedValue({ data: null, error: { message: 'That session no longer exists.' } })
    render(<SecuritySection />)
    await screen.findByText('Test browser')

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'wrong-current-password' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a-strong-new-password' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'a-strong-new-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Current password is incorrect.')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That session no longer exists.')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
