import { useEffect, useId, useState } from 'react'
import type { FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { API_BASE, isServerConfigured } from '../data/apiConfig'
import { Button, FieldError } from '../components/common/ui'
import { inputClass } from '../components/common/controls'
import { Button as ShadButton } from '../components/ui/button'
import { APP_NAME } from '@capacitylens/shared/brand'
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '@capacitylens/shared/domain/password'
import { messageForFailure } from './resetPasswordFailure'
import { m } from '@/i18n'
import { requestSignal } from '../data/requestTimeout'

// Password-reset page for /reset-password/:token. The token arrives out-of-band — an
// Owner/Admin minted it in Team & access and handed the link over directly (the app has no
// email infrastructure, a standing non-goal). This page collects the new password and POSTs Better
// Auth's PUBLIC redeem endpoint, `${API_BASE}/api/auth/reset-password` — a plain fetch, not the
// better-auth client, so this lazy chunk stays free of the auth bundle (the endpoint is one JSON
// POST; the client library adds nothing here). The server is the authority: single-use consumption,
// expiry, and password length all live there — this page only pre-checks what saves a round trip
// (mismatched confirmation, an obviously-short password) and renders the outcome.
//
// AUTH WALL: unlike /invite/:token this page must work with NO session — the visitor is exactly the
// person who CANNOT sign in. AuthProvider carves this path out of the login wall (see the
// status.kind === 'login' branch there); the redeem endpoint sits under /api/auth/*, which the
// server's requireUser preHandler already exempts.

type State =
  | { kind: 'form' }
  | { kind: 'working' }
  | { kind: 'done' }
  | { kind: 'unknown' }
  | { kind: 'local' } // the demo build (no server) — password reset is a server-mode feature

/**
 * Reset-password page for `/reset-password/:token`.
 *
 * Renders a new-password + confirmation form and redeems the admin-issued single-use token against
 * Better Auth's public reset endpoint. Success offers "Go to sign in" as a FULL page load (a plain
 * anchor, not a router <Link>): there is no session, so a clean boot is what lands the visitor on
 * the login screen — client-side navigation would leave AuthProvider's boot-time status stale. In
 * the demo build (VITE_CAPACITYLENS_DEMO=1) there is no server, so it shows a short note and makes no
 * request. Surface-not-swallow: every failure path lands on a visible message.
 */
export function ResetPassword() {
  const { token } = useParams<{ token: string }>()
  const [state, setState] = useState<State>(() => (isServerConfigured() ? { kind: 'form' } : { kind: 'local' }))
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Stable ids so both inputs can point at the shared form-level error (WCAG 3.3.1) — the
  // LoginScreen idiom: describedby re-announces the reason as the user navigates back.
  const passwordId = useId()
  const confirmId = useId()
  const errorId = useId()

  // Per-route document.title (WCAG 2.4.2) — this route renders OUTSIDE AppShell (see router.tsx),
  // so the shell's nav-driven title effect never covers it (the InviteAccept idiom).
  useEffect(() => {
    document.title = `${m.reset_title()} · ${APP_NAME}`
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    // Defensive: the route shape guarantees a token; a hand-mangled URL still gets a clear message.
    if (!token) {
      setError(m.reset_err_missing_token())
      return
    }
    // Pre-checks that save a round trip; the server re-enforces the length on redeem.
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(m.reset_err_short({ min: MIN_PASSWORD_LENGTH }))
      return
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      setError(m.reset_err_long({ max: MAX_PASSWORD_LENGTH }))
      return
    }
    if (password !== confirm) {
      setError(m.reset_err_mismatch())
      return
    }
    setError(null)
    setState({ kind: 'working' })
    try {
      const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: password, token }),
        signal: requestSignal(),
      })
      if (res.ok) {
        setState({ kind: 'done' })
        return
      }
      const body = (await res.json().catch(() => ({}))) as { code?: string }
      setError(messageForFailure(body))
      setState({ kind: 'form' })
    } catch (err) {
      // A pre-response transport error (server down, DNS, offline) — surface a generic, actionable
      // message rather than a dead end, and log the real cause for debugging.
      console.error('ResetPassword: reset request failed', err)
      setError(null)
      setState({ kind: 'unknown' })
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-6">
      <main className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mb-1 text-2xl font-bold text-brand">{APP_NAME}</div>
          <h1 className="text-lg font-semibold text-ink">{m.reset_title()}</h1>
          {state.kind !== 'done' && state.kind !== 'local' && (
            <p className="text-sm text-muted">{m.reset_subtitle()}</p>
          )}
        </div>
        <div className="rounded-lg border border-line bg-surface p-4 shadow-sm">
          {(state.kind === 'form' || state.kind === 'working') && (
            <form onSubmit={(e) => void submit(e)} noValidate className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink">{m.reset_new_password()}</span>
                <input
                  id={passwordId}
                  data-testid="reset-new-password"
                  className={inputClass}
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-describedby={error ? errorId : undefined}
                  autoFocus
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink">{m.reset_confirm_password()}</span>
                <input
                  id={confirmId}
                  data-testid="reset-confirm-password"
                  className={inputClass}
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  aria-describedby={error ? errorId : undefined}
                />
              </label>
              <FieldError id={errorId}>{error}</FieldError>
              <div className="flex justify-end">
                <Button type="submit" testId="reset-submit" disabled={state.kind === 'working'}>
                  {m.reset_submit()}
                </Button>
              </div>
              {state.kind === 'working' && (
                <p role="status" className="text-sm text-muted">
                  {m.reset_working()}
                </p>
              )}
            </form>
          )}
          {(state.kind === 'done' || state.kind === 'unknown') && (
            <div className="space-y-3">
              <p role="status" data-testid="reset-success" className="text-sm font-medium text-ink">
                {state.kind === 'done'
                  ? m.reset_success()
                  : 'The reset request had an unknown outcome. Try signing in with the new password; request a replacement reset link only if sign-in fails.'}
              </p>
              <div className="flex justify-end">
                {/* A FULL load, deliberately not a router <Link>: there is no session, and a clean
                    boot is what re-runs AuthProvider's /me check and lands on the login screen. */}
                <ShadButton asChild size="sm">
                  <a href="/">{m.reset_go_signin()}</a>
                </ShadButton>
              </div>
            </div>
          )}
          {state.kind === 'local' && (
            <p className="text-sm text-muted">{m.reset_local_mode({ app: APP_NAME })}</p>
          )}
        </div>
      </main>
    </div>
  )
}
