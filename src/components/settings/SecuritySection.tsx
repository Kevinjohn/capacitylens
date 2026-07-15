import { useCallback, useEffect, useId, useState } from 'react'
import type { FormEvent } from 'react'
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '@capacitylens/shared/domain/password'
import { authClient } from '../../auth/authClient'
import { Button, FieldError } from '../common/ui'
import { inputClass } from '../common/controls'

interface SessionView {
  token: string
  createdAt: Date
  expiresAt: Date
  ipAddress?: string | null
  userAgent?: string | null
}

export function SecuritySection() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [sessions, setSessions] = useState<SessionView[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const errorId = useId()

  const loadSessions = useCallback(async () => {
    try {
      const result = await authClient.listSessions()
      if (result.error || !Array.isArray(result.data)) {
        setError(result.error?.message ?? 'Active sessions could not be loaded.')
        return
      }
      setSessions(result.data as SessionView[])
    } catch (cause) {
      console.error('SecuritySection: session list failed', cause)
      setError('Active sessions could not be loaded.')
    }
  }, [])

  useEffect(() => {
    // The state changes happen only after the external session request settles.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSessions()
  }, [loadSessions])

  const changePassword = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setMessage(null)
    if (newPassword.length < MIN_PASSWORD_LENGTH || newPassword.length > MAX_PASSWORD_LENGTH) {
      setError(`Use between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`)
      return
    }
    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.')
      return
    }
    setBusy(true)
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      })
      if (result.error) {
        setError(result.error.message ?? 'The password could not be changed.')
      } else {
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
        setMessage('Password changed. Other sessions were revoked.')
        await loadSessions()
      }
    } catch (cause) {
      console.error('SecuritySection: password change failed', cause)
      setError('The authentication service could not be reached.')
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (token: string) => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await authClient.revokeSession({ token })
      if (result.error) setError(result.error.message ?? 'The session could not be revoked.')
      else {
        setMessage('Session revoked.')
        await loadSessions()
      }
    } catch (cause) {
      console.error('SecuritySection: session revoke failed', cause)
      setError('The authentication service could not be reached.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section data-testid="security-section" className="rounded border border-line bg-surface p-4">
      <h2 className="mb-1 text-sm font-semibold text-ink">Security</h2>
      <p className="mb-4 text-xs text-muted">Change your password and review signed-in devices.</p>

      <form className="space-y-3" onSubmit={(event) => void changePassword(event)}>
        <h3 className="text-sm font-medium text-ink">Change password</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs text-muted">Current password</span>
            <input className={inputClass} type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted">New password</span>
            <input className={inputClass} type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} maxLength={MAX_PASSWORD_LENGTH} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted">Confirm new password</span>
            <input className={inputClass} type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
          </label>
        </div>
        <Button type="submit" disabled={busy || !currentPassword || !newPassword || !confirmPassword}>Change password</Button>
      </form>

      <div className="mt-5 border-t border-line pt-4">
        <h3 className="text-sm font-medium text-ink">Active sessions</h3>
        <ul className="mt-2 space-y-2">
          {sessions.map((session) => (
            <li key={session.token} className="flex items-center justify-between gap-3 rounded bg-canvas p-2 text-xs">
              <span className="min-w-0 text-muted">
                <span className="block truncate text-ink">{session.userAgent || 'Unknown device'}</span>
                {session.ipAddress || 'Unknown IP'} · created {new Date(session.createdAt).toLocaleString()} · expires {new Date(session.expiresAt).toLocaleString()}
              </span>
              <Button variant="ghost" disabled={busy} onClick={() => void revoke(session.token)}>Revoke</Button>
            </li>
          ))}
        </ul>
      </div>

      <FieldError id={errorId}>{error}</FieldError>
      {message && <p role="status" className="mt-2 text-sm text-ok">{message}</p>}
    </section>
  )
}
