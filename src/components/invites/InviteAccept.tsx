import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { isServerConfigured } from '../../data/apiConfig'
import {
  accountClient,
  accountCommandOutcomeUnknown,
  newBrowserAccountCommand,
  type BrowserAccountCommand,
} from '../../account/accountClient'
import { fetchAccountSummaries } from '../../auth/useAccountSummaries'
import { readApiError } from '../../lib/readApiError'
import { useStore } from '../../store/useStore'
import { authClient } from '../../auth/authClient'
import { Button, FieldError } from '../common/ui'
import { inputClass, linkButtonClass } from '../common/controls'
import { APP_NAME } from '@capacitylens/shared/brand'
import { m } from '@/i18n'
import { validateText } from '../../lib/validation'
import { MAX_EMAIL_LENGTH, MAX_NAME_LENGTH } from '@capacitylens/shared/lib/strings'
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '@capacitylens/shared/domain/password'
import type { Role } from '@capacitylens/shared/domain/access'
import { isAccountRole, type InvitationRole } from '@capacitylens/shared/account/types'
import { roleLabel, roleSummary } from '../../lib/accessCopy'
import { Badge } from '../ui/badge'
import { useAuth } from '../../auth/authContext'
import {
  clearExternalSignInError,
  externalSignInErrorUrl,
  hasExternalSignInError,
} from '../../auth/externalSignInError'
import {
  reloadCurrentPage,
  replaceWithAccountPicker,
  replaceWithJoinedAccount,
} from '../../lib/joinedAccountHandoff'

// Invite accept page for /invite/:token. On mount, in SERVER mode, it previews the invite.
// A signed-in person must then explicitly accept before the single-use POST is sent. The server is
// the authority: a valid link binds the invited role to the signed-in caller's membership; a
// used/expired/unknown link is refused. This page never re-implements that policy client-side.
//
// PRE-SESSION ONBOARDING: this route sits inside AuthProvider but outside AppShell's tenant gate.
// Password mode deliberately carves it out of the login wall so a genuinely new invitee can create
// a credential through the token-scoped signup endpoint; an existing user can sign in here and the
// page reloads the same token URL so they can review and explicitly accept as that identity.

type State =
  | { kind: 'previewing' }
  | { kind: 'ready' }
  | { kind: 'accepting' }
  // `activating` = the best-effort switch-into-the-joined-company step (summaries refetch +
  // setActiveAccount) hasn't settled yet. The success message renders as soon as we're 'joined';
  // the Continue link renders only once `activating` is false — see the effect for why.
  | { kind: 'joined'; accountId: string; role: Role; activating: boolean }
  | { kind: 'error'; message: string; retryAccept?: boolean }
  | { kind: 'auth'; message?: string }
  | { kind: 'local' } // the demo build (no server) — invites are a server-mode feature

interface InvitePreview {
  accountName: string
  role: InvitationRole
  expiresAt: string
}

// Map the accept endpoint's status codes to the surfaced message. 404/409/410 are the documented
// invite outcomes (unknown / already-used / expired); the server's JSON `{ error }` body carries a
// friendly sentence we prefer, with a safe fallback per status when the body is missing/unreadable.
function messageForStatus(status: number, bodyError: string | undefined): string {
  if (bodyError) return bodyError
  if (status === 404) return m.invite_err_not_found()
  if (status === 409) return m.invite_err_used()
  if (status === 410) return m.invite_err_expired()
  if (status === 401) return m.invite_err_signin()
  return m.invite_err_generic()
}
function parsePreview(value: unknown): InvitePreview | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (typeof row.accountName !== 'string' || row.accountName.trim().length === 0) return null
  if (!isAccountRole(row.role) || row.role === 'owner') return null
  if (typeof row.expiresAt !== 'string' || !Number.isFinite(Date.parse(row.expiresAt))) return null
  return { accountName: row.accountName, role: row.role, expiresAt: row.expiresAt }
}

async function accountFailure(response: Response): Promise<{ code: string | null; message: string | null }> {
  const body: unknown = await response.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { code: null, message: null }
  const failure = body as { code?: unknown; error?: unknown }
  return {
    code: typeof failure.code === 'string' ? failure.code : null,
    message: typeof failure.error === 'string' && failure.error.length > 0 ? failure.error : null,
  }
}

/**
 * Invite-accept page for `/invite/:token` (P1.9).
 *
 * In server mode it previews the invite, asks a signed-in person to accept explicitly, then renders
 * a "you've joined" success (with a continue link after switching to the joined company), the
 * matching endpoint error, or a generic failure. In the demo build there is no server to accept
 * against, so it shows a short "invites require server mode" note and makes no request.
 */
export function InviteAccept() {
  const { token } = useParams<{ token: string }>()
  // React Router may preserve the route element while only changing `:token`. Key the stateful
  // implementation so preview data and command identities can never cross invitation URLs.
  return <InviteAcceptForToken key={token ?? ''} token={token} />
}

function InviteAcceptForToken({ token }: { token: string | undefined }) {
  const { authMode, user, providers: configuredProviders, refreshAuth } = useAuth()
  const providers = configuredProviders ?? []
  const [returnedWithExternalError] = useState(() => hasExternalSignInError(window.location.href))
  const setActiveAccount = useStore((s) => s.setActiveAccount)
  const setAccountSummaries = useStore((s) => s.setAccountSummaries)
  // The initial render already encodes the no-fetch outcomes (the demo build; a missing token — which the
  // `/invite/:token` route shouldn't even match, but is handled defensively), so the effect never has
  // to setState synchronously: it only ever sets state from an async fetch callback.
  const [state, setState] = useState<State>(() => {
    if (!isServerConfigured()) return { kind: 'local' }
    if (!token) return { kind: 'error', message: m.invite_err_missing_token() }
    return { kind: 'previewing' }
  })
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [busy, setBusy] = useState(false)
  const errorId = useId()
  // Records a successfully parsed preview, not an in-flight attempt. React StrictMode cancels and
  // restarts effects in development; marking the first attempt as complete before it resolves would
  // suppress the replacement request and strand the page on “Checking invite…”.
  const previewed = useRef<string | null>(null)
  const currentUser = useRef(user)
  const accepting = useRef(false)
  const acceptCommand = useRef<BrowserAccountCommand | null>(null)
  const signupCommand = useRef<BrowserAccountCommand | null>(null)

  useEffect(() => {
    currentUser.current = user
  }, [user])

  useEffect(() => {
    if (!returnedWithExternalError) return
    window.history.replaceState(
      window.history.state,
      '',
      clearExternalSignInError(window.location.href),
    )
  }, [returnedWithExternalError])

  // Preserve the command across a true retry with unchanged credential input. Once the person
  // edits the semantic payload, a new idempotency identity is required or the server must correctly
  // reject it as a conflicting reuse of the prior command.
  useEffect(() => {
    signupCommand.current = newBrowserAccountCommand()
  }, [token, name, email, password])

  // Per-route document.title (WCAG 2.4.2). This route renders OUTSIDE AppShell (see router.tsx), so
  // it isn't covered by the shell's nav-driven title effect — set it here from the same `invite_title`
  // message the heading uses ("Accept invite"), so the tab/history/bookmark reads descriptively rather
  // than index.html's static brand. `APP_NAME` keeps the brand single-sourced (see shared/brand).
  useEffect(() => {
    document.title = `${m.invite_title()} · ${APP_NAME}`
  }, [])

  useEffect(() => {
    if (!isServerConfigured() || !token) return // demo build / no token: nothing to preview
    let cancelled = false

    void (async () => {
      try {
        const previewResponse = await accountClient.previewInvitation(token)
        if (cancelled) return
        if (!previewResponse.ok) {
          setState({ kind: 'error', message: messageForStatus(previewResponse.status, await readApiError(previewResponse)) })
          return
        }
        const parsedPreview = parsePreview(await previewResponse.json().catch(() => null))
        if (cancelled) return
        if (!parsedPreview) {
          setState({ kind: 'error', message: m.invite_err_preview_invalid() })
          return
        }
        previewed.current = token
        setPreview(parsedPreview)
        setState(currentUser.current
          ? { kind: 'ready' }
          : {
              kind: 'auth',
              ...(returnedWithExternalError ? { message: m.login_sso_failed() } : {}),
            })
      } catch (err) {
        if (cancelled) return
        // Preview is read-only, so a transport failure cannot have consumed the invite. Keep this
        // distinct from an accept failure, whose outcome may genuinely be unknown.
        console.error('InviteAccept: preview request failed', err)
        setState({ kind: 'error', message: m.invite_err_network() })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [returnedWithExternalError, token])

  const acceptInvite = async (): Promise<void> => {
    if (!token || previewed.current !== token || accepting.current) return
    accepting.current = true
    setBusy(true)
    setState({ kind: 'accepting' })
    try {
      const command = acceptCommand.current ?? (acceptCommand.current = newBrowserAccountCommand())
      const res = await accountClient.acceptInvitation(token, command)
      if (!res.ok) {
        const failure = await accountFailure(res)
        const outcomeUnknown = res.status >= 500 ||
          (res.status === 409 && failure.code === 'COMMAND_IN_PROGRESS')
        if (
          res.status >= 400 && res.status < 500 &&
          (res.status !== 409 || failure.code !== 'COMMAND_IN_PROGRESS')
        ) {
          acceptCommand.current = newBrowserAccountCommand()
        }
        if (res.status === 401) {
          setState({ kind: 'auth' })
        } else {
          let reconciliation = ''
          if (outcomeUnknown) {
            const list = await fetchAccountSummaries({ allowCachedFallback: false })
            if (list !== null) setAccountSummaries(list)
            reconciliation = list !== null
              ? 'Your company list was refreshed; check it before safely retrying this same request.'
              : 'Your company list could not be refreshed. Reload before safely retrying this same request.'
          }
          setState({
            kind: 'error',
            message: outcomeUnknown
              ? `${failure.message ?? 'The invite request has not reached a final result.'} ${reconciliation}`
              : messageForStatus(res.status, failure.message ?? undefined),
            retryAccept: outcomeUnknown,
          })
        }
        return
      }

      const body = (await res.json().catch(() => ({}))) as { accountId?: string; role?: string }
      const accountId = typeof body.accountId === 'string' && body.accountId.length > 0 ? body.accountId : ''
      if (!accountId || !isAccountRole(body.role)) {
        const list = await fetchAccountSummaries({ allowCachedFallback: false })
        if (list !== null) setAccountSummaries(list)
        setState({
          kind: 'error',
          message: list !== null
            ? 'The invite may have been accepted, but the server returned an invalid result. The company list was refreshed; continue to the app to verify membership.'
            : 'The invite may have been accepted, but the server returned an invalid result and the company list could not be refreshed. Reload to verify membership.',
        })
        return
      }

      // Use the role returned by the mutation, not the proposed role in the preview: the server may
      // have resolved an existing membership with a different effective role.
      setState({ kind: 'joined', accountId, role: body.role, activating: true })
      const list = await fetchAccountSummaries({
        signal: AbortSignal.timeout(5000),
        allowCachedFallback: false,
      })
      if (list !== null) {
        setAccountSummaries(list)
        if (list.some((account) => account.id === accountId)) setActiveAccount(accountId)
      }
      setState((current) => (current.kind === 'joined' ? { ...current, activating: false } : current))
    } catch (error) {
      // The POST may have reached the server before the transport failed, so do not invite a blind
      // retry. Refresh authoritative membership state and explain how to verify the outcome.
      console.error('InviteAccept: accept request failed', error)
      const list = await fetchAccountSummaries({ allowCachedFallback: false })
      if (list !== null) setAccountSummaries(list)
      setState({
        kind: 'error',
        message: list !== null
          ? 'The invite request had an unknown outcome. Your company list was refreshed; continue to the app to check whether you joined before retrying the link.'
          : 'The invite request had an unknown outcome and your company list could not be refreshed. Reload before retrying the link.',
        retryAccept: true,
      })
    } finally {
      accepting.current = false
      setBusy(false)
    }
  }

  const signInAndReload = async (): Promise<void> => {
    const { error } = await authClient.signIn.email({ email, password })
    if (error) throw new Error(error.message ?? m.login_failed())
    reloadCurrentPage()
  }

  /** Recheck the new cookie and authoritative companies before entering AppShell. The invite page
   * booted without a session, so its initial persistence bootstrap is deliberately unattached after
   * the 401. A fresh boot is required for safe saving; its one-use query value is verified against
   * `/api/accounts` by AppShell before activation and then removed from the URL. */
  const enterJoinedCompany = async (accountId?: string): Promise<void> => {
    await refreshAuth()
    const list = await fetchAccountSummaries({
      signal: AbortSignal.timeout(5000),
      allowCachedFallback: false,
    })
    if (list !== null) {
      setAccountSummaries(list)
      const target = accountId
        ? list.find((account) => account.id === accountId)
        : list.length === 1 ? list[0] : undefined
      if (target) {
        setActiveAccount(target.id)
        replaceWithJoinedAccount(target.id)
        return
      }
    }
    // A failed authoritative list read cannot safely activate a caller-supplied id. Reboot into the
    // ordinary authenticated picker, which retries the list without trusting the invite response.
    replaceWithAccountPicker()
  }

  const signIn = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setState({ kind: 'auth' })
    try {
      await signInAndReload()
    } catch (error) {
      setState({ kind: 'auth', message: error instanceof Error ? error.message : m.login_failed() })
      setBusy(false)
    }
  }

  const signInWithProvider = async (provider: (typeof providers)[number]): Promise<void> => {
    setBusy(true)
    setState({ kind: 'auth' })
    try {
      const result = provider.kind === 'oidc'
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
        setState({ kind: 'auth', message: result.error.message ?? m.login_failed() })
        setBusy(false)
      }
    } catch (error) {
      console.error('InviteAccept: SSO sign-in request failed', error)
      setState({ kind: 'auth', message: m.login_network_error() })
      setBusy(false)
    }
  }

  const createAccount = async () => {
    if (!token || previewed.current !== token) return
    const report = (_field: string | null, message: string) => setState({ kind: 'auth', message })
    const cleanName = validateText(name, report, { field: 'name', requiredMessage: m.identity_err_name() })
    if (cleanName === null) return
    const cleanEmail = email.trim().toLowerCase()
    if (cleanEmail.length === 0 || cleanEmail.length > MAX_EMAIL_LENGTH || !/^[^@\s]+@[^@\s]+$/.test(cleanEmail)) {
      report('email', m.identity_err_email())
      return
    }
    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      report('password', m.identity_err_password({ min: MIN_PASSWORD_LENGTH, max: MAX_PASSWORD_LENGTH }))
      return
    }
    setBusy(true)
    setState({ kind: 'auth' })
    let commandOutcomeUnknown = false
    try {
      const command = signupCommand.current ?? (signupCommand.current = newBrowserAccountCommand())
      const res = await accountClient.signupWithInvitation(token, {
        name: cleanName,
        email: cleanEmail,
        password,
      }, command)
      if (!res.ok) {
        commandOutcomeUnknown = await accountCommandOutcomeUnknown(res)
        const failure = await accountFailure(res)
        if (res.status >= 400 && res.status < 500 && !commandOutcomeUnknown) {
          signupCommand.current = newBrowserAccountCommand()
        }
        throw new Error(failure.message ?? messageForStatus(res.status, undefined))
      }
      const signupBody = (await res.json().catch(() => null)) as Record<string, unknown> | null
      const accountId = typeof signupBody?.accountId === 'string' && signupBody.accountId.length > 0
        ? signupBody.accountId
        : null
      if (!accountId || !isAccountRole(signupBody?.role)) {
        throw new Error('The account was created, but the server returned an invalid company result. Sign in to verify the new membership.')
      }
      const { error } = await authClient.signIn.email({ email: cleanEmail, password })
      if (error) throw new Error(error.message ?? m.login_failed())
      // Signup already claimed the invite atomically. Verify the exact company, then start a fresh
      // authenticated boot with persistence attached and a one-use activation handoff.
      await enterJoinedCompany(accountId)
    } catch (error) {
      const transportFailure = error instanceof TypeError ||
        (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError'))
      const unknownFailure = transportFailure || commandOutcomeUnknown
      if (unknownFailure) {
        try {
          const signInResult = await authClient.signIn.email({ email: cleanEmail, password })
          if (!signInResult.error) {
            // Do not guess from the caller's company count: the signup request may never have reached
            // the server and these credentials may belong to an existing identity. Reload the same
            // bearer URL; an unused invite can then be accepted explicitly, while a consumed invite
            // truthfully reports that state and lets the caller inspect their authenticated picker.
            reloadCurrentPage()
            return
          }
        } catch (signInError) {
          // The recovery probe is best-effort and may fail for the same network reason as signup.
          // Keep the original unknown-outcome guidance and restore the form instead of leaking a
          // rejected event-handler promise that leaves the page permanently busy.
          console.warn('InviteAccept: signup recovery sign-in failed', signInError)
        }
      }
      setState({
        kind: 'auth',
        message: unknownFailure
          ? 'Account creation had an unknown outcome. Try signing in with these credentials before creating another account.'
          : error instanceof Error ? error.message : m.invite_err_generic(),
      })
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-6">
      <main className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mb-1 text-2xl font-bold text-brand">{APP_NAME}</div>
          <h1 className="text-lg font-semibold text-ink">{m.invite_title()}</h1>
        </div>
        <div className="space-y-3 rounded-lg border border-line bg-surface p-4 shadow-sm">
          {preview && (
            <section className="rounded-md border border-line bg-canvas p-3" data-testid="invite-preview">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted">{m.invite_company_label()}</p>
                  <h2 className="mt-0.5 text-base font-semibold text-ink">{preview.accountName}</h2>
                </div>
                <div className="text-right">
                  <p className="text-xs font-medium text-muted">{m.invite_proposed_role_label()}</p>
                  <Badge>{roleLabel(preview.role)}</Badge>
                </div>
              </div>
              <p className="mt-2 text-sm text-muted">{roleSummary(preview.role)}</p>
              <p className="mt-2 text-xs text-muted">{m.invite_existing_role_note()}</p>
              <p className="mt-2 text-xs text-muted">
                {m.invite_expires({ when: new Date(preview.expiresAt).toLocaleString() })}
              </p>
            </section>
          )}
          {state.kind === 'previewing' && (
            <p role="status" className="text-sm text-muted">
              {m.invite_checking()}
            </p>
          )}
          {state.kind === 'ready' && (
            <>
              <p className="text-sm text-muted">{m.invite_review_prompt()}</p>
              <div className="flex flex-wrap justify-end gap-2">
                <Link to="/" className={linkButtonClass}>
                  {m.invite_go_to_app()}
                </Link>
                <Button type="button" disabled={busy} onClick={() => void acceptInvite()}>
                  {m.invite_accept_action()}
                </Button>
              </div>
            </>
          )}
          {state.kind === 'accepting' && (
            <p role="status" className="text-sm text-muted">
              {m.invite_joining()}
            </p>
          )}
          {state.kind === 'joined' && (
            <>
              <p role="status" className="text-sm font-medium text-ink">
                {preview
                  ? m.invite_joined_company({ company: preview.accountName, role: roleLabel(state.role) })
                  : `${m.invite_joined_base()}${state.role ? m.invite_joined_role({ role: state.role }) : ''}.`}
              </p>
              {/* Continue appears only once the best-effort activation step has settled (see the
                  effect): rendering it earlier would let a click race the setActiveAccount and land
                  on the picker even when activation was about to succeed. */}
              {!state.activating && (
                <div className="flex justify-end">
                  <Link to="/" className={linkButtonClass}>
                    {m.invite_continue()}
                  </Link>
                </div>
              )}
            </>
          )}
          {state.kind === 'auth' && (
            authMode === 'sso' ? (
              <div className="space-y-3">
                <p className="text-sm text-muted">
                  Sign in with the invited identity, then review and accept this invitation.
                </p>
                <FieldError id={errorId}>{state.message}</FieldError>
                {providers.length === 0 ? (
                  <FieldError>No single sign-on provider is available. Contact the operator.</FieldError>
                ) : (
                  <div className="space-y-2">
                    {providers.map((provider) => (
                      <Button
                        key={provider.id}
                        type="button"
                        className="w-full"
                        disabled={busy}
                        onClick={() => void signInWithProvider(provider)}
                      >
                        Continue with {provider.label}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
            <div className="space-y-4">
            {providers.length > 0 && (
              <div className="space-y-2">
                {providers.map((provider) => (
                  <Button
                    key={provider.id}
                    type="button"
                    className="w-full"
                    disabled={busy}
                    onClick={() => void signInWithProvider(provider)}
                  >
                    Continue with {provider.label}
                  </Button>
                ))}
                <p className="text-center text-xs text-muted">or use an email and password</p>
              </div>
            )}
            <form onSubmit={(event) => void signIn(event)} className="space-y-3" noValidate>
              <p className="text-sm text-muted">{m.invite_onboard_intro()}</p>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink">{m.invite_name()}</span>
                <input
                  className={inputClass}
                  type="text"
                  autoComplete="name"
                  value={name}
                  maxLength={MAX_NAME_LENGTH}
                  onChange={(event) => setName(event.target.value)}
                  aria-describedby={state.message ? errorId : undefined}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink">{m.login_email()}</span>
                <input
                  className={inputClass}
                  type="email"
                  autoComplete="email"
                  value={email}
                  maxLength={MAX_EMAIL_LENGTH}
                  onChange={(event) => setEmail(event.target.value)}
                  aria-describedby={state.message ? errorId : undefined}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink">{m.login_password()}</span>
                <input
                  className={inputClass}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  minLength={MIN_PASSWORD_LENGTH}
                  maxLength={MAX_PASSWORD_LENGTH}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-describedby={state.message ? errorId : undefined}
                />
              </label>
              <FieldError id={errorId}>{state.message}</FieldError>
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="submit" variant="ghost" disabled={busy}>
                  {m.invite_sign_in_accept()}
                </Button>
                <Button type="button" disabled={busy} onClick={() => void createAccount()}>
                  {m.invite_create_account()}
                </Button>
              </div>
            </form>
            </div>
            )
          )}
          {state.kind === 'error' && (
            <>
              <FieldError>{state.message}</FieldError>
              <div className="flex flex-wrap justify-end gap-2">
                <Link to="/" className={linkButtonClass}>
                  {m.invite_go_to_app()}
                </Link>
                {state.retryAccept && preview && user && (
                  <Button type="button" disabled={busy} onClick={() => void acceptInvite()}>
                    Retry accept
                  </Button>
                )}
              </div>
            </>
          )}
          {state.kind === 'local' && (
            <>
              <p className="text-sm text-muted">{m.invite_local_mode({ app: APP_NAME })}</p>
              <div className="flex justify-end">
                <Link to="/" className={linkButtonClass}>
                  {m.invite_go_to_app()}
                </Link>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
