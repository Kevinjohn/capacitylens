import { useEffect, useId, useState } from 'react'
import type { FormEvent } from 'react'
import { APP_NAME } from '@capacitylens/shared/brand'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Checkbox } from '../components/ui/checkbox'
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from '../components/ui/field'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { authClient } from './authClient'
import type { PublicAuthEntry } from './authEntryRoute'
import { m } from '@/i18n'

type Setup = { totpURI: string; backupCodes: string[] }

/** Decode the auth HTTP boundary before a malformed success can replace the recoverable form. */
function decodeSetup(value: unknown): Setup | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const { totpURI, backupCodes } = value as Record<string, unknown>
  if (typeof totpURI !== 'string' || totpURI.trim().length === 0) return null
  if (
    !Array.isArray(backupCodes) ||
    backupCodes.length === 0 ||
    !backupCodes.every((backupCode) =>
      typeof backupCode === 'string' && backupCode.trim().length > 0)
  ) return null
  return { totpURI, backupCodes: [...backupCodes] }
}

/** Mandatory pre-data enrollment wall for a password deployment that requires MFA. */
export function MfaEnrollmentScreen({ onEnrolled, onSignOut, blockedEntry = null }: {
  onEnrolled: () => void
  onSignOut: () => void
  blockedEntry?: PublicAuthEntry
}) {
  const [password, setPassword] = useState('')
  const [setup, setSetup] = useState<Setup | null>(null)
  const [code, setCode] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const errorId = useId()

  // AuthProvider renders this mandatory wall instead of the router, so AppShell cannot set or
  // replace document.title while enrollment is required.
  useEffect(() => {
    document.title = `${m.mfa_enrollment_title()} · ${APP_NAME}`
  }, [])

  const start = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await authClient.twoFactor.enable({
        ...(password ? { password } : {}),
        issuer: APP_NAME,
      })
      if (result.error) {
        setError(result.error.message ?? m.mfa_enrollment_start_failed())
      } else {
        const decoded = decodeSetup(result.data)
        if (!decoded) {
          setError(m.mfa_enrollment_invalid_response())
        } else {
          setSetup(decoded)
          setPassword('')
        }
      }
    } catch (cause) {
      console.error('MfaEnrollmentScreen: enrollment start failed', cause)
      setError(m.auth_service_unreachable())
    } finally {
      setBusy(false)
    }
  }

  const finish = async (event: FormEvent) => {
    event.preventDefault()
    if (!saved) return
    setBusy(true)
    setError(null)
    try {
      const result = await authClient.twoFactor.verifyTotp({ code, trustDevice: false })
      if (result.error) {
        setError(result.error.message ?? m.mfa_enrollment_code_rejected())
      } else {
        onEnrolled()
      }
    } catch (cause) {
      console.error('MfaEnrollmentScreen: verification failed', cause)
      setError(m.auth_service_unreachable())
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle><h1>{m.mfa_enrollment_title()}</h1></CardTitle>
          <CardDescription>
            {m.mfa_enrollment_description()}
            {blockedEntry === 'password-reset' && (
              <span className="mt-2 block font-medium text-ink">
                {m.mfa_enrollment_password_reset_blocked()}
              </span>
            )}
            {blockedEntry === 'invitation' && (
              <span className="mt-2 block font-medium text-ink">
                {m.mfa_enrollment_invitation_blocked()}
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
        {!setup ? (
          <form onSubmit={(event) => void start(event)}>
            <FieldGroup className="gap-3">
              <Field>
                <FieldLabel htmlFor="mfa-enroll-password">{m.mfa_enrollment_current_password()}</FieldLabel>
                <Input
                id="mfa-enroll-password"
                data-testid="mfa-enroll-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
              />
                <FieldDescription>{m.mfa_enrollment_password_hint()}</FieldDescription>
              </Field>
            <FieldError id={errorId}>{error}</FieldError>
            <div className="flex items-center justify-between">
              <Button size="sm" type="button" variant="outline" onClick={onSignOut}>{m.common_sign_out()}</Button>
              <Button size="sm" type="submit" disabled={busy}>{m.common_continue()}</Button>
            </div>
            </FieldGroup>
          </form>
        ) : (
          <form onSubmit={(event) => void finish(event)}>
            <FieldGroup className="gap-4">
            <div>
              <h2 className="text-sm font-semibold text-ink">{m.mfa_enrollment_step_authenticator()}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{m.mfa_enrollment_authenticator_hint()}</p>
              <a className="mt-2 block break-all rounded bg-canvas p-2 font-mono text-xs text-brand underline" href={setup.totpURI}>
                {setup.totpURI}
              </a>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-ink">{m.mfa_enrollment_step_recovery()}</h2>
              <ul className="mt-2 grid grid-cols-2 gap-1 rounded bg-canvas p-3 font-mono text-xs text-ink">
                {setup.backupCodes.map((backupCode) => <li key={backupCode}>{backupCode}</li>)}
              </ul>
              <Field orientation="horizontal">
                <Checkbox id="mfa-codes-saved" checked={saved} onCheckedChange={(checked) => setSaved(checked === true)} />
                <FieldContent>
                  <FieldLabel htmlFor="mfa-codes-saved">{m.mfa_enrollment_recovery_saved()}</FieldLabel>
                </FieldContent>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="mfa-enroll-code">{m.mfa_enrollment_step_code()}</FieldLabel>
              <Input
                id="mfa-enroll-code"
                data-testid="mfa-enroll-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                value={code}
                onChange={(event) => setCode(event.target.value.trim())}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
              />
            </Field>
            <FieldError id={errorId}>{error}</FieldError>
            <Button size="sm" type="submit" data-testid="mfa-enroll-submit" disabled={busy || !saved || code.length !== 6}>
              {m.mfa_enrollment_enable()}
            </Button>
            </FieldGroup>
          </form>
        )}
        </CardContent>
      </Card>
    </main>
  )
}
