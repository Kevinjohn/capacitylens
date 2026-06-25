import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button, FieldError } from '../components/common/ui'
import { inputClass } from '../components/common/controls'
import { authClient } from './authClient'
import { APP_NAME } from '@capacitylens/shared/brand'

// The flag-gated login wall (production plan P3.3; US-NAV-10). Only ever rendered when
// the server reports authMode 'password' or 'sso' AND there is no session — the default
// deploy (auth off) and local mode never see it. Driven by Better Auth's React client;
// no sign-up form this round (accounts are created via the API by whoever runs the demo).

export function LoginScreen({
  authMode,
  onSignedIn,
}: {
  authMode: 'password' | 'sso'
  onSignedIn: () => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const signInWithPassword = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { error: failure } = await authClient.signIn.email({ email, password })
      if (failure) {
        setError(failure.message ?? 'Sign-in failed.')
        setBusy(false)
        return
      }
      onSignedIn()
    } catch (err) {
      // Better Auth returns an auth FAILURE as { error } (handled above). A THROW here is a
      // pre-response network/transport error — without this catch `busy` stayed true forever (button
      // stuck disabled, no message). Surface a generic message + reset busy; log the real cause.
      console.error('LoginScreen: password sign-in request failed', err)
      setError('Could not reach the server. Check your connection and try again.')
      setBusy(false)
    }
  }

  const signInWithSso = async () => {
    setBusy(true)
    setError(null)
    try {
      // On success the client follows the provider redirect; only a failure returns here.
      const { error: failure } = await authClient.signIn.oauth2({
        providerId: 'sso',
        callbackURL: window.location.href,
      })
      if (failure) {
        setError(failure.message ?? 'Sign-in failed.')
        setBusy(false)
      }
    } catch (err) {
      // Same as the password path: a thrown (pre-redirect) network error would otherwise strand the
      // button disabled with no feedback. Surface it and reset busy.
      console.error('LoginScreen: SSO sign-in request failed', err)
      setError('Could not reach the server. Check your connection and try again.')
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-6">
      <main className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mb-1 text-2xl font-bold text-brand">{APP_NAME}</div>
          <h1 className="text-lg font-semibold text-ink">Sign in</h1>
          <p className="text-sm text-muted">This workspace requires an account.</p>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4 shadow-sm">
          {authMode === 'password' ? (
            <form onSubmit={(e) => void signInWithPassword(e)} noValidate className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink">Email</span>
                <input
                  className={inputClass}
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink">Password</span>
                <input
                  className={inputClass}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <FieldError>{error}</FieldError>
              <div className="flex justify-end">
                <Button type="submit" disabled={busy}>
                  Sign in
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-3">
              <FieldError>{error}</FieldError>
              <Button onClick={() => void signInWithSso()} disabled={busy}>
                Continue with SSO
              </Button>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
