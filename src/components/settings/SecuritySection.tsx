import { useCallback, useEffect, useId, useState } from 'react'
import type { FormEvent } from 'react'
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '@capacitylens/shared/domain/password'
import { authClient } from '../../auth/authClient'
import { accountClient, accountCommandOutcomeUnknown } from '../../account/accountClient'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Field, FieldError, FieldGroup, FieldLabel } from '../ui/field'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Separator } from '../ui/separator'

interface SessionView {
  id: string
  createdAt: string
  expiresAt: string | null
  current: boolean
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

  const loadSessions = useCallback(async (): Promise<'loaded' | 'unauthorized' | 'failed'> => {
    try {
      const response = await accountClient.listSessions()
      const body: unknown = await response.json().catch(() => null)
      if (!response.ok || !Array.isArray(body)) {
        setError('Active sessions could not be loaded.')
        return response.status === 401 ? 'unauthorized' : 'failed'
      }
      const valid = body.filter((value): value is SessionView => {
        if (!value || typeof value !== 'object') return false
        const row = value as Partial<SessionView>
        return typeof row.id === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(row.id) &&
          typeof row.createdAt === 'string' && Number.isFinite(Date.parse(row.createdAt)) &&
          (row.expiresAt === null || (
            typeof row.expiresAt === 'string' && Number.isFinite(Date.parse(row.expiresAt))
          )) && typeof row.current === 'boolean'
      })
      if (valid.length !== body.length) {
        setError('Active sessions returned an invalid response.')
        return 'failed'
      }
      setSessions(valid)
      setError(null)
      return 'loaded'
    } catch (cause) {
      console.error('SecuritySection: session list failed', cause)
      setError('Active sessions could not be loaded.')
      return 'failed'
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

  const revoke = async (sessionId: string) => {
    const revokingCurrentSession = sessions.some((session) => session.id === sessionId && session.current)
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const response = await accountClient.revokeOwnSession(sessionId)
      if (!response.ok) {
        if (await accountCommandOutcomeUnknown(response)) {
          // The server may have committed before a proxy/worker failure obscured the response.
          // If this is the current session, tenant data must leave the screen immediately because
          // no follow-up response can prove that the browser cookie survived. Other sessions can
          // be reconciled through an authoritative list refresh.
          if (revokingCurrentSession || response.status === 401) {
            window.location.reload()
            return
          }
          const refreshOutcome = await loadSessions()
          if (refreshOutcome === 'unauthorized') {
            window.location.reload()
            return
          }
          setMessage(refreshOutcome === 'loaded'
            ? 'The revoke request had an unknown outcome. Sessions were refreshed; verify the result before retrying.'
            : 'The revoke request had an unknown outcome and sessions could not be refreshed. Reload before retrying.')
        } else {
          setError('The session could not be revoked.')
        }
      } else {
        setSessions((current) => current.filter((session) => session.id !== sessionId))
        setMessage('Session revoked.')
        // A current-session revocation invalidates the cookie server-side. Re-enter through the
        // normal auth-status wall immediately rather than leaving a visually authenticated shell
        // that will fail on its next API request.
        if (revokingCurrentSession) window.location.reload()
      }
    } catch (cause) {
      console.error('SecuritySection: session revoke failed', cause)
      if (revokingCurrentSession) {
        window.location.reload()
        return
      }
      const refreshOutcome = await loadSessions()
      if (refreshOutcome === 'unauthorized') {
        window.location.reload()
        return
      }
      setMessage(refreshOutcome === 'loaded'
        ? 'The revoke request had an unknown outcome. Sessions were refreshed; verify the result before retrying.'
        : 'The revoke request had an unknown outcome and sessions could not be refreshed. Reload before retrying.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card data-testid="security-section">
      <CardHeader>
        <CardTitle>Security</CardTitle>
        <CardDescription>Change your password and review signed-in devices.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form onSubmit={(event) => void changePassword(event)}>
          <FieldGroup className="gap-3">
            <h3 className="text-sm font-medium text-ink">Change password</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="security-current-password">Current password</FieldLabel>
                <Input id="security-current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="security-new-password">New password</FieldLabel>
                <Input id="security-new-password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} maxLength={MAX_PASSWORD_LENGTH} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="security-confirm-password">Confirm new password</FieldLabel>
                <Input id="security-confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
              </Field>
            </div>
            <Button size="sm" type="submit" disabled={busy || !currentPassword || !newPassword || !confirmPassword}>Change password</Button>
          </FieldGroup>
        </form>

        <Separator />
        <div>
        <h3 className="text-sm font-medium text-ink">Active sessions</h3>
        <ul className="mt-2 flex flex-col gap-2">
          {sessions.map((session) => (
            <li key={session.id} className="flex items-center justify-between gap-3 rounded bg-canvas p-2 text-xs">
              <span className="min-w-0 text-muted-foreground">
                <span className="block truncate text-ink">{session.current ? 'Current session' : 'Signed-in session'}</span>
                created {new Date(session.createdAt).toLocaleString()} · {session.expiresAt
                  ? `expires ${new Date(session.expiresAt).toLocaleString()}`
                  : 'no fixed expiry'}
              </span>
              <Button size="sm" type="button" variant="outline" disabled={busy} onClick={() => void revoke(session.id)}>Revoke</Button>
            </li>
          ))}
        </ul>
        </div>

        <FieldError id={errorId}>{error}</FieldError>
        {message && <p role="status" className="text-sm text-ok">{message}</p>}
      </CardContent>
    </Card>
  )
}
