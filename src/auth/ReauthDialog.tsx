import { useState } from 'react'
import { Modal } from '../components/common/ui'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Field, FieldError, FieldLabel } from '../components/ui/field'
import { authClient } from './authClient'
import { m } from '@/i18n'
import type { AuthProviderInfo, AuthUser } from './authContext'
import { resolveReauth } from './reauthCoordinator'
import { externalSignInErrorUrl } from './externalSignInError'

// The "Confirm it's you" step-up dialog (DEFECT B). Rendered by ReauthMount (AuthProvider) ONLY
// while a re-auth is pending, and lazy-loaded so Better Auth's client (authClient) never enters the
// main bundle — the same discipline as LoginScreen / MfaEnrollmentScreen. It reuses the app's own
// Modal shell + Button/FieldError, so it inherits the existing dismiss/focus/i18n behaviour rather
// than inventing a new dialog.
//
// PASSWORD mode: a fresh `signIn.email` mints a new session (sessionCreatedAt = now) WITHOUT a page
// reload, so the user keeps their place; on success we resolve the coordinator and the pending API
// call is transparently retried (see apiFetchReauth). A 2FA account gets an inline TOTP step (the
// same second-factor path LoginScreen uses). SSO mode delegates to the identity provider via the
// same redirect the sign-in screen uses — that inherently reloads on return, at which point the
// session is fresh and the user simply repeats the action.

export function ReauthDialog({
  authMode,
  user,
  providers,
}: {
  authMode: 'password' | 'sso'
  user: AuthUser | null
  providers: AuthProviderInfo[]
}) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Flips true when the password step reports a second factor is required — reveals the TOTP field
  // in the same dialog rather than dead-ending a 2FA account (mirrors LoginScreen's two-phase flow).
  const [twoFactorPending, setTwoFactorPending] = useState(false)
  const [code, setCode] = useState('')

  const email = user?.email ?? ''

  const cancel = () => resolveReauth(false)

  const confirmPassword = async () => {
    if (busy) return
    if (email.length === 0) {
      // Password mode always resolves an email on /me; its absence means we cannot re-auth by
      // password here. Surface it rather than submit a blank credential.
      setError(m.reauth_failed())
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { data, error: failure } = await authClient.signIn.email({ email, password })
      if (failure) {
        setError(failure.message ?? m.reauth_failed())
        setBusy(false)
        return
      }
      if ((data as { twoFactorRedirect?: unknown } | null)?.twoFactorRedirect === true) {
        setTwoFactorPending(true)
        setBusy(false)
        return
      }
      resolveReauth(true) // fresh session — apiFetchReauth retries the pending action
    } catch (err) {
      // A THROW is a pre-response transport error (an auth FAILURE comes back as { error } above).
      // Surface it + reset busy so the button never sticks disabled; log the real cause.
      console.error('ReauthDialog: password re-auth request failed', err)
      setError(m.login_network_error())
      setBusy(false)
    }
  }

  const confirmSecondFactor = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await authClient.twoFactor.verifyTotp({ code, trustDevice: false })
      if (result.error) {
        setError(result.error.message ?? m.reauth_failed())
        setBusy(false)
        return
      }
      resolveReauth(true)
    } catch (err) {
      console.error('ReauthDialog: second-factor re-auth verification failed', err)
      setError(m.login_network_error())
      setBusy(false)
    }
  }

  const reauthWithProvider = async (provider: AuthProviderInfo) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      // The SAME redirect the sign-in screen uses. On success the client follows the provider
      // redirect (this page unloads and returns with a fresh session); only a failure returns here.
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
      if (result.error) {
        setError(result.error.message ?? m.reauth_failed())
        setBusy(false)
      }
    } catch (err) {
      console.error('ReauthDialog: SSO re-auth request failed', err)
      setError(m.login_network_error())
      setBusy(false)
    }
  }

  // SSO step-up: delegate to the identity provider. A skewed/empty provider list can't offer a
  // button — surface the same "no provider configured" copy the login screen uses, with only Cancel.
  if (authMode === 'sso') {
    return (
      <Modal
        title={m.reauth_title()}
        onClose={cancel}
        guardDirty={false}
        footer={
          <Button size="sm" type="button" variant="outline" onClick={cancel}>
            {m.form_cancel()}
          </Button>
        }
      >
        <p className="text-sm text-muted-foreground">{m.reauth_body_sso()}</p>
        <FieldError>{error}</FieldError>
        {providers.length > 0 ? (
          <div className="flex flex-col gap-2">
            {providers.map((provider) => (
              <Button size="sm"
                key={`${provider.kind}:${provider.id}`}
                variant="outline"
                onClick={() => void reauthWithProvider(provider)}
                disabled={busy}
              >
                {m.login_continue_with({ provider: provider.label })}
              </Button>
            ))}
          </div>
        ) : (
          <FieldError>{m.login_sso_unavailable()}</FieldError>
        )}
      </Modal>
    )
  }

  // 2FA second step of the password flow.
  if (twoFactorPending) {
    return (
      <Modal
        title={m.reauth_title()}
        onClose={cancel}
        onSubmit={() => void confirmSecondFactor()}
        guardDirty={false}
        footer={
          <>
            <Button size="sm" type="button" variant="outline" onClick={cancel}>
              {m.form_cancel()}
            </Button>
            <Button size="sm" type="submit" data-testid="reauth-2fa-submit" disabled={busy || code.length === 0}>
              {m.reauth_2fa_submit()}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">{m.reauth_2fa_body()}</p>
        <Field>
          <FieldLabel htmlFor="reauth-2fa-code">{m.reauth_2fa_label()}</FieldLabel>
          <Input
            id="reauth-2fa-code"
            data-testid="reauth-2fa-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.trim())}
            autoFocus
          />
        </Field>
        <FieldError>{error}</FieldError>
      </Modal>
    )
  }

  // Password step-up (the common self-host path).
  return (
    <Modal
      title={m.reauth_title()}
      onClose={cancel}
      onSubmit={() => void confirmPassword()}
      guardDirty={false}
      footer={
        <>
          <Button size="sm" type="button" variant="outline" onClick={cancel}>
            {m.form_cancel()}
          </Button>
          <Button size="sm" type="submit" data-testid="reauth-submit" disabled={busy}>
            {m.reauth_submit()}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">{m.reauth_body()}</p>
      <Field>
        <FieldLabel htmlFor="reauth-password">{m.login_password()}</FieldLabel>
        <Input
          id="reauth-password"
          data-testid="reauth-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
      </Field>
      <FieldError>{error}</FieldError>
    </Modal>
  )
}
