import { useState } from 'react'
import type { FormEvent } from 'react'
import { APP_NAME } from '@capacitylens/shared/brand'
import { Button, FieldError } from '../components/common/ui'
import { inputClass } from '../components/common/controls'
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
      <div className="w-full max-w-lg rounded-lg border border-line bg-surface p-5 shadow-sm">
        <h1 className="text-xl font-semibold text-ink">Secure your account</h1>
        <p className="mt-2 text-sm text-muted">
          CapacityLens requires a time-based code in addition to your sign-in method.
        </p>

        {!setup ? (
          <form className="mt-5 space-y-3" onSubmit={(event) => void start(event)}>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink">Current password</span>
              <input
                data-testid="mfa-enroll-password"
                className={inputClass}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <span className="mt-1 block text-xs text-muted">Leave blank if you sign in only through SSO.</span>
            </label>
            <FieldError>{error}</FieldError>
            <div className="flex items-center justify-between">
              <Button type="button" variant="ghost" onClick={onSignOut}>Sign out</Button>
              <Button type="submit" disabled={busy}>Continue</Button>
            </div>
          </form>
        ) : (
          <form className="mt-5 space-y-4" onSubmit={(event) => void finish(event)}>
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
              <label className="mt-2 flex items-start gap-2 text-sm text-ink">
                <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
                I stored the recovery codes somewhere safe.
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink">3. Authentication code</span>
              <input
                data-testid="mfa-enroll-code"
                className={inputClass}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value.trim())}
              />
            </label>
            <FieldError>{error}</FieldError>
            <Button type="submit" testId="mfa-enroll-submit" disabled={busy || !saved || code.length !== 6}>
              Enable MFA
            </Button>
          </form>
        )}
      </div>
    </main>
  )
}
