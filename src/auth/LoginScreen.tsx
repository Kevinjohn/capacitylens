import { useEffect, useId, useState } from 'react'
import type { FormEvent } from 'react'
import { Button, Callout, FieldError } from '../components/common/ui'
import { inputClass } from '../components/common/controls'
import { authClient } from './authClient'
import { APP_NAME } from '@capacitylens/shared/brand'
import { m } from '@/i18n'
import type { AuthProviderInfo } from './authContext'
import { validateText } from '../lib/validation'
import { MAX_EMAIL_LENGTH, MAX_NAME_LENGTH } from '@capacitylens/shared/lib/strings'
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '@capacitylens/shared/domain/password'
import {
  clearExternalSignInError,
  externalSignInErrorUrl,
  hasExternalSignInError,
} from './externalSignInError'

// The flag-gated login wall (production plan P3.3; US-NAV-10). Only ever rendered when
// the server reports authMode 'password' or 'sso' AND there is no session — the default
// deploy (auth off) and the demo build never see it. Driven by Better Auth's React client.
// The ONE sign-up form is the first-run owner setup: when the server reports `needsSetup`
// (password mode + zero users — sign-up requires the operator's setup token),
// the screen offers "Create the owner account" instead of a dead-end sign-in; every other
// password identity is created through a valid invite (self-registration stays closed).

export function LoginScreen({
  authMode,
  needsSetup = false,
  providers = [],
  degraded = false,
  onSignedIn,
}: {
  authMode: 'password' | 'sso'
  /** Server-reported first-run state (password mode + empty user table). Fail-closed default:
   *  absent means the ordinary sign-in form. */
  needsSetup?: boolean
  providers?: AuthProviderInfo[]
  /** True when AuthProvider fell back to this form because the 401 body itself was untrustworthy
   *  (non-JSON/HTML/junk authMode), not because the server genuinely reported password mode. Shows
   *  a non-terminal advisory above the form — see AuthProvider's Status.degraded doc comment. */
  degraded?: boolean
  onSignedIn: () => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [setupToken, setSetupToken] = useState('')
  const [returnedWithExternalError] = useState(() => hasExternalSignInError(window.location.href))
  const [error, setError] = useState<string | null>(() =>
    returnedWithExternalError ? m.login_sso_failed() : null)
  const [busy, setBusy] = useState(false)
  const [twoFactorPending, setTwoFactorPending] = useState(false)
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const [useRecoveryCode, setUseRecoveryCode] = useState(false)
  // Flips true the moment OUR owner-setup submit is refused because someone else's setup
  // already won the race (server's live per-request gate — see server/src/auth.ts). needsSetup
  // is a one-time snapshot from page load, so a second tab/operator can still see the create-owner
  // form after the workspace is bootstrapped; this local override forces the ordinary sign-in
  // form instead of leaving the loser stuck on a dead-end create-owner form. Never flips back.
  const [setupClosed, setSetupClosed] = useState(false)
  // Stable ids so each input can point at the shared error message (WCAG 3.3.1). A sign-in
  // failure is form-level (not field-specific), so we describe BOTH inputs by the one error and
  // skip aria-invalid — describedby is what re-announces the reason as the user navigates back.
  const nameId = useId()
  const emailId = useId()
  const passwordId = useId()
  const setupTokenId = useId()
  const errorId = useId()
  const setup = authMode === 'password' && needsSetup && !setupClosed

  useEffect(() => {
    if (!returnedWithExternalError) return
    window.history.replaceState(
      window.history.state,
      '',
      clearExternalSignInError(window.location.href),
    )
  }, [returnedWithExternalError])

  const signInWithPassword = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { data, error: failure } = await authClient.signIn.email({ email, password })
      if (failure) {
        setError(failure.message ?? m.login_failed())
        setBusy(false)
        return
      }
      if ((data as { twoFactorRedirect?: unknown } | null)?.twoFactorRedirect === true) {
        setTwoFactorPending(true)
        setBusy(false)
        return
      }
      onSignedIn()
    } catch (err) {
      // Better Auth returns an auth FAILURE as { error } (handled above). A THROW here is a
      // pre-response network/transport error — without this catch `busy` stayed true forever (button
      // stuck disabled, no message). Surface a generic message + reset busy; log the real cause.
      console.error('LoginScreen: password sign-in request failed', err)
      setError(m.login_network_error())
      setBusy(false)
    }
  }

  const verifySecondFactor = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = useRecoveryCode
        ? await authClient.twoFactor.verifyBackupCode({ code: twoFactorCode, trustDevice: false })
        : await authClient.twoFactor.verifyTotp({ code: twoFactorCode, trustDevice: false })
      if (result.error) {
        setError(result.error.message ?? m.login_failed())
        setBusy(false)
        return
      }
      onSignedIn()
    } catch (err) {
      console.error('LoginScreen: second-factor verification failed', err)
      setError(m.login_network_error())
      setBusy(false)
    }
  }

  const createOwner = async (e: FormEvent) => {
    e.preventDefault()
    const cleanName = validateText(name, (_field, message) => setError(message), {
      field: 'name',
      requiredMessage: m.identity_err_name(),
    })
    if (cleanName === null) return
    const cleanEmail = email.trim().toLowerCase()
    if (cleanEmail.length === 0 || cleanEmail.length > MAX_EMAIL_LENGTH || !/^[^@\s]+@[^@\s]+$/.test(cleanEmail)) {
      setError(m.identity_err_email())
      return
    }
    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      setError(m.identity_err_password({ min: MIN_PASSWORD_LENGTH, max: MAX_PASSWORD_LENGTH }))
      return
    }
    setBusy(true)
    setError(null)
    try {
      // Better Auth auto-signs-in on sign-up, so success proceeds exactly like a sign-in:
      // onSignedIn() reloads and the boot re-check finds the fresh session cookie.
      const { error: failure } = await authClient.signUp.email({
        email: cleanEmail,
        password,
        name: cleanName,
        fetchOptions: { headers: { 'x-capacitylens-setup-token': setupToken } },
      })
      if (failure) {
        // The live per-request gate (server/src/auth.ts) closes the instant a user exists, so a
        // second tab/operator racing our own first-run setup gets refused with this EXACT typed
        // code — Better Auth's disableSignUp shape, reused verbatim by our hook. That's the ONE
        // failure that isn't really "your input was wrong": someone else already finished setup,
        // so drop out of setup mode into ordinary sign-in rather than leave the loser stuck on a
        // dead-end create-owner form with no recovery but a manual reload.
        if (failure.code === 'EMAIL_PASSWORD_SIGN_UP_DISABLED') {
          setError(m.login_setup_taken())
          setSetupClosed(true)
          setBusy(false)
          return
        }
        // Any other reason (e.g. password too short) — surface Better Auth's own message; a
        // generic message would hide the fix.
        setError(failure.message ?? m.login_setup_failed())
        setBusy(false)
        return
      }
      onSignedIn()
    } catch (err) {
      // Same contract as the sign-in path: a THROW is a pre-response network/transport error —
      // surface a generic message + reset busy so the button never sticks disabled; log the cause.
      console.error('LoginScreen: owner-setup sign-up request failed', err)
      setError(m.login_network_error())
      setBusy(false)
    }
  }

  const signInWithProvider = async (provider: AuthProviderInfo) => {
    setBusy(true)
    setError(null)
    try {
      // On success the client follows the provider redirect; only a failure returns here.
      const result =
        provider.kind === 'oidc'
          ? await authClient.signIn.oauth2({
              providerId: provider.id,
              callbackURL: window.location.href,
              errorCallbackURL: externalSignInErrorUrl(window.location.href),
            })
          : await authClient.signIn.social({
              provider: provider.id as 'google' | 'microsoft' | 'github',
              callbackURL: window.location.href,
            })
      const failure = result.error
      if (failure) {
        setError(failure.message ?? m.login_failed())
        setBusy(false)
      }
    } catch (err) {
      // Same as the password path: a thrown (pre-redirect) network error would otherwise strand the
      // button disabled with no feedback. Surface it and reset busy.
      console.error('LoginScreen: SSO sign-in request failed', err)
      setError(m.login_network_error())
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-6">
      <main className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mb-1 text-2xl font-bold text-brand">{APP_NAME}</div>
          <h1 className="text-lg font-semibold text-ink">
            {setup ? m.login_setup_heading() : m.login_sign_in()}
          </h1>
          <p className="text-sm text-muted">{setup ? m.login_setup_subtitle() : m.login_subtitle()}</p>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4 shadow-sm">
          {/* Non-terminal advisory (§1 DEFENSIVE-CODING.md — surface, never swallow): the 401 body
              itself was untrustworthy, so this password form is a guess, not a confirmed signal.
              Never rendered for a well-formed password-mode 401 or a valid SSO body — see
              AuthProvider.Status.degraded. */}
          {degraded && (
            <div className="mb-4">
              <Callout>{m.login_degraded_notice()}</Callout>
            </div>
          )}
          {twoFactorPending ? (
            <form onSubmit={(e) => void verifySecondFactor(e)} noValidate className="space-y-3">
              <p className="text-sm text-muted">
                {useRecoveryCode
                  ? 'Enter one unused recovery code.'
                  : 'Enter the six-digit code from your authenticator app.'}
              </p>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink">
                  {useRecoveryCode ? 'Recovery code' : 'Authentication code'}
                </span>
                <input
                  data-testid="mfa-code"
                  className={inputClass}
                  type="text"
                  inputMode={useRecoveryCode ? 'text' : 'numeric'}
                  autoComplete="one-time-code"
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value.trim())}
                  aria-describedby={error ? errorId : undefined}
                  autoFocus
                />
              </label>
              <FieldError id={errorId}>{error}</FieldError>
              <div className="flex items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => { setUseRecoveryCode((value) => !value); setTwoFactorCode(''); setError(null) }}
                >
                  {useRecoveryCode ? 'Use authenticator code' : 'Use a recovery code'}
                </Button>
                <Button type="submit" testId="mfa-submit" disabled={busy || twoFactorCode.length === 0}>
                  Verify
                </Button>
              </div>
            </form>
          ) : setup ? (
            <form onSubmit={(e) => void createOwner(e)} noValidate className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink">{m.login_name()}</span>
                <input
                  id={nameId}
                  data-testid="owner-setup-name"
                  className={inputClass}
                  type="text"
                  autoComplete="name"
                  value={name}
                  maxLength={MAX_NAME_LENGTH}
                  onChange={(e) => setName(e.target.value)}
                  // Same form-level error contract as sign-in: describe every field by the one
                  // error only while it's showing (WCAG 3.3.1).
                  aria-describedby={error ? errorId : undefined}
                  autoFocus
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink">{m.login_email()}</span>
                <input
                  id={emailId}
                  data-testid="owner-setup-email"
                  className={inputClass}
                  type="email"
                  autoComplete="email"
                  value={email}
                  maxLength={MAX_EMAIL_LENGTH}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-describedby={error ? errorId : undefined}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink">{m.login_password()}</span>
                <input
                  id={passwordId}
                  data-testid="owner-setup-password"
                  className={inputClass}
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  minLength={MIN_PASSWORD_LENGTH}
                  maxLength={MAX_PASSWORD_LENGTH}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-describedby={error ? errorId : undefined}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink">{m.login_setup_token()}</span>
                <input
                  id={setupTokenId}
                  data-testid="owner-setup-token"
                  className={inputClass}
                  type="password"
                  autoComplete="off"
                  value={setupToken}
                  onChange={(e) => setSetupToken(e.target.value)}
                  placeholder={m.login_setup_token_placeholder()}
                  aria-describedby={error ? errorId : undefined}
                />
              </label>
              <FieldError id={errorId}>{error}</FieldError>
              <div className="flex justify-end">
                <Button type="submit" testId="owner-setup-submit" disabled={busy}>
                  {m.login_create_owner()}
                </Button>
              </div>
            </form>
          ) : authMode === 'password' ? (
            <form onSubmit={(e) => void signInWithPassword(e)} noValidate className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink">{m.login_email()}</span>
                <input
                  id={emailId}
                  className={inputClass}
                  type="email"
                  autoComplete="email"
                  value={email}
                  maxLength={MAX_EMAIL_LENGTH}
                  onChange={(e) => setEmail(e.target.value)}
                  // Describe by the form-level error only while it's showing, so the reason is
                  // re-announced when focus returns to this field (WCAG 3.3.1).
                  aria-describedby={error ? errorId : undefined}
                  autoFocus
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink">{m.login_password()}</span>
                <input
                  id={passwordId}
                  className={inputClass}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  maxLength={MAX_PASSWORD_LENGTH}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-describedby={error ? errorId : undefined}
                />
              </label>
              <FieldError id={errorId}>{error}</FieldError>
              <div className="flex justify-end">
                <Button type="submit" disabled={busy}>
                  {m.login_sign_in()}
                </Button>
              </div>
            </form>
          ) : null}
          {!setup && providers.length > 0 && (
            <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
              {providers.some((provider) => provider.experimental) ? (
                <p className="text-xs text-muted">{m.login_external_experimental()}</p>
              ) : null}
              <FieldError>{authMode === 'sso' ? error : null}</FieldError>
              {providers.map((provider) => (
                <Button key={`${provider.kind}:${provider.id}`} variant="ghost" onClick={() => void signInWithProvider(provider)} disabled={busy}>
                  {m.login_continue_with({ provider: provider.label })}
                </Button>
              ))}
            </div>
          )}
          {!setup && authMode === 'sso' && providers.length === 0 && (
            <FieldError>{m.login_sso_unavailable()}</FieldError>
          )}
        </div>
      </main>
    </div>
  )
}
