import { useState } from 'react'
import type { FormEvent } from 'react'
import { APP_NAME } from '@capacitylens/shared/brand'
import { Button, FieldError } from '../components/common/ui'
import { Input } from '../components/ui/input'
import { Checkbox } from '../components/ui/checkbox'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '../components/ui/field'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { authClient } from './authClient'

type Setup = { totpURI: string; backupCodes: string[] }

/** Mandatory pre-data enrollment wall for a password deployment that requires MFA. */
export function MfaEnrollmentScreen({ onEnrolled, onSignOut }: {
  onEnrolled: () => void
  onSignOut: () => void
}) {
  const [password, setPassword] = useState('')
  const [setup, setSetup] = useState<Setup | null>(null)
  const [code, setCode] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await authClient.twoFactor.enable({
        ...(password ? { password } : {}),
        issuer: APP_NAME,
      })
      if (result.error || !result.data) {
        setError(result.error?.message ?? 'MFA enrollment could not be started.')
      } else {
        setSetup({ totpURI: result.data.totpURI, backupCodes: result.data.backupCodes })
        setPassword('')
      }
    } catch (cause) {
      console.error('MfaEnrollmentScreen: enrollment start failed', cause)
      setError('The authentication service could not be reached.')
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
        setError(result.error.message ?? 'The authentication code was not accepted.')
      } else {
        onEnrolled()
      }
    } catch (cause) {
      console.error('MfaEnrollmentScreen: verification failed', cause)
      setError('The authentication service could not be reached.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle><h1>Secure your account</h1></CardTitle>
          <CardDescription>CapacityLens requires a time-based code in addition to your sign-in method.</CardDescription>
        </CardHeader>
        <CardContent>
        {!setup ? (
          <form onSubmit={(event) => void start(event)}>
            <FieldGroup className="gap-3">
              <Field>
                <FieldLabel htmlFor="mfa-enroll-password">Current password</FieldLabel>
                <Input
                id="mfa-enroll-password"
                data-testid="mfa-enroll-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
                <FieldDescription>Leave blank if you sign in only through SSO.</FieldDescription>
              </Field>
            <FieldError>{error}</FieldError>
            <div className="flex items-center justify-between">
              <Button type="button" variant="ghost" onClick={onSignOut}>Sign out</Button>
              <Button type="submit" disabled={busy}>Continue</Button>
            </div>
            </FieldGroup>
          </form>
        ) : (
          <form onSubmit={(event) => void finish(event)}>
            <FieldGroup className="gap-4">
            <div>
              <h2 className="text-sm font-semibold text-ink">1. Add the authenticator entry</h2>
              <p className="mt-1 text-xs text-muted">Open this URI in an authenticator app, or copy it into the app manually.</p>
              <a className="mt-2 block break-all rounded bg-canvas p-2 font-mono text-xs text-brand underline" href={setup.totpURI}>
                {setup.totpURI}
              </a>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-ink">2. Save these one-time recovery codes</h2>
              <ul className="mt-2 grid grid-cols-2 gap-1 rounded bg-canvas p-3 font-mono text-xs text-ink">
                {setup.backupCodes.map((backupCode) => <li key={backupCode}>{backupCode}</li>)}
              </ul>
              <Field orientation="horizontal">
                <Checkbox id="mfa-codes-saved" checked={saved} onCheckedChange={(checked) => setSaved(checked === true)} />
                <FieldContent>
                  <FieldLabel htmlFor="mfa-codes-saved">I stored the recovery codes somewhere safe.</FieldLabel>
                </FieldContent>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="mfa-enroll-code">3. Authentication code</FieldLabel>
              <Input
                id="mfa-enroll-code"
                data-testid="mfa-enroll-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value.trim())}
              />
            </Field>
            <FieldError>{error}</FieldError>
            <Button type="submit" testId="mfa-enroll-submit" disabled={busy || !saved || code.length !== 6}>
              Enable MFA
            </Button>
            </FieldGroup>
          </form>
        )}
        </CardContent>
      </Card>
    </main>
  )
}
