import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { API_BASE, isServerConfigured } from '../../data/apiConfig'
import { apiFetch } from '../../data/requestTimeout'
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

// Invite accept page (P1.9; route /invite/:token). On mount, in SERVER mode, it POSTs
// `${API_BASE}/api/invites/:token/accept` (credentials included so the session cookie rides along).
// The server is the authority: a valid link binds the invited role to the signed-in caller's
// membership; a used/expired/unknown link is refused. This page only renders the outcome — it never
// re-implements the single-use/expiry policy client-side.
//
// PRE-SESSION ONBOARDING: this route sits inside AuthProvider but outside AppShell's tenant gate.
// Password mode deliberately carves it out of the login wall so a genuinely new invitee can create
// a credential through the token-scoped signup endpoint; an existing user can sign in here and the
// page reloads the same token URL to accept with the resulting session cookie.

type State =
  | { kind: 'working' }
  // `activating` = the best-effort switch-into-the-joined-company step (summaries refetch +
  // setActiveAccount) hasn't settled yet. The success message renders as soon as we're 'joined';
  // the Continue link renders only once `activating` is false — see the effect for why.
  | { kind: 'joined'; accountId: string; role: string; activating: boolean }
  | { kind: 'error'; message: string }
  | { kind: 'auth'; message?: string }
  | { kind: 'local' } // the demo build (no server) — invites are a server-mode feature

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
const isRole = (value: unknown): value is Role =>
  value === 'owner' || value === 'admin' || value === 'editor' || value === 'viewer'

/**
 * Invite-accept page for `/invite/:token` (P1.9).
 *
 * In server mode it POSTs the accept endpoint once on mount and renders one of: a "you've joined"
 * success (with a continue link to the app, after switching the active company to the joined
 * account), the matching error for a 404/409/410/401, or a generic failure. In the demo build
 * (VITE_CAPACITYLENS_DEMO=1) there is no server to accept against, so it shows a short "invites require
 * server mode" note and makes no request. Surface-not-swallow: every failure path lands on a visible
 * message; nothing is silently dropped.
 */
export function InviteAccept() {
  const { token } = useParams<{ token: string }>()
  const setActiveAccount = useStore((s) => s.setActiveAccount)
  const setAccountSummaries = useStore((s) => s.setAccountSummaries)
  // The initial render already encodes the no-fetch outcomes (the demo build; a missing token — which the
  // `/invite/:token` route shouldn't even match, but is handled defensively), so the effect never has
  // to setState synchronously: it only ever sets state from an async fetch callback.
  const [state, setState] = useState<State>(() => {
    if (!isServerConfigured()) return { kind: 'local' }
    if (!token) return { kind: 'error', message: m.invite_err_missing_token() }
    return { kind: 'working' }
  })
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const errorId = useId()
  // Fire the accept EXACTLY once. accept is single-use, so we MUST NOT POST twice — React 18/19
  // StrictMode double-invokes effects in dev, and any cleanup-then-rerun would otherwise either send
  // a second (409-ing) POST or, if we abort the first on cleanup, strand the page on "Joining…" with
  // the result discarded. A ref guard dedupes the POST and the result is always applied (setState
  // after an unmount is a no-op in React 18+, not a warning — no abort/cancel flag is needed here).
  const fired = useRef(false)

  // Per-route document.title (WCAG 2.4.2). This route renders OUTSIDE AppShell (see router.tsx), so
  // it isn't covered by the shell's nav-driven title effect — set it here from the same `invite_title`
  // message the heading uses ("Accept invite"), so the tab/history/bookmark reads descriptively rather
  // than index.html's static brand. `APP_NAME` keeps the brand single-sourced (see shared/brand).
  useEffect(() => {
    document.title = `${m.invite_title()} · ${APP_NAME}`
  }, [])

  useEffect(() => {
    if (!isServerConfigured() || !token) return // demo build / no token: nothing to accept against
    if (fired.current) return
    fired.current = true

    void (async () => {
      try {
        const res = await apiFetch(`${API_BASE}/api/invites/${encodeURIComponent(token)}/accept`, {
          method: 'POST',
          credentials: 'include',
        })
        if (res.ok) {
          const body = (await res.json().catch(() => ({}))) as { accountId?: string; role?: string }
          const accountId = typeof body.accountId === 'string' && body.accountId.length > 0 ? body.accountId : ''
          if (!accountId || !isRole(body.role)) {
            const list = await fetchAccountSummaries()
            if (list !== null) setAccountSummaries(list)
            setState({
              kind: 'error',
              message: 'The invite may have been accepted, but the server returned an invalid result. The company list was refreshed; continue to the app to verify membership.',
            })
            return
          }
          // Show the SUCCESS FIRST: the single-use token is consumed the moment the POST succeeds,
          // so the outcome must never be held hostage to the follow-up summaries fetch — a hanging
          // GET would strand the user on "Joining…" with the membership already granted and the
          // link already dead. The activation below is a bounded best-effort extra.
          setState({ kind: 'joined', accountId, role: body.role, activating: true })
          if (accountId !== '') {
            // Switch the active company to the one just joined so the Continue link lands in it.
            // This route mounts OUTSIDE AppShell, so useAccountSummaries hasn't run here: the joined
            // account is in neither `data.accounts` nor `accountSummaries`, and a bare
            // setActiveAccount would REJECT it as unknown (dropping to the picker with a spurious
            // "company not found" notice). Pull a fresh summaries list first and activate only once
            // the account is in it. BOUNDED to 5s: fetchAccountSummaries reports any failure —
            // including this timeout — as null (fail-soft, no toast), in which case activation is
            // skipped and Continue lands on the picker, whose own summaries fetch (AppShell mount)
            // lists the new membership.
            const list = await fetchAccountSummaries({ signal: AbortSignal.timeout(5000) })
            if (list !== null) {
              setAccountSummaries(list)
              if (list.some((a) => a.id === accountId)) setActiveAccount(accountId)
            }
            // The Continue link renders only now that activation has SETTLED (succeeded or not), so
            // clicking it deterministically lands in the joined company whenever activation worked.
            setState((s) => (s.kind === 'joined' ? { ...s, activating: false } : s))
          }
          return
        }
        if (res.status === 401) {
          setState({ kind: 'auth' })
          return
        }
        setState({ kind: 'error', message: messageForStatus(res.status, await readApiError(res)) })
      } catch (err) {
        // A pre-response transport error (server down, DNS, offline) — surface a generic, actionable
        // message rather than a dead end, and log the real cause for debugging.
        console.error('InviteAccept: accept request failed', err)
        const list = await fetchAccountSummaries()
        if (list !== null) setAccountSummaries(list)
        setState({
          kind: 'error',
          message: 'The invite request had an unknown outcome. Your company list was refreshed; continue to the app to check whether you joined before retrying the link.',
        })
      }
    })()
  }, [token, setActiveAccount, setAccountSummaries])

  const signInAndReload = async (): Promise<void> => {
    const { error } = await authClient.signIn.email({ email, password })
    if (error) throw new Error(error.message ?? m.login_failed())
    window.location.reload()
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

  const createAccount = async () => {
    if (!token) return
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
    try {
      const res = await apiFetch(`${API_BASE}/api/invites/${encodeURIComponent(token)}/signup`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: cleanName, email: cleanEmail, password }),
      })
      if (!res.ok) {
        throw new Error((await readApiError(res)) ?? messageForStatus(res.status, undefined))
      }
      const { error } = await authClient.signIn.email({ email: cleanEmail, password })
      if (error) throw new Error(error.message ?? m.login_failed())
      // Signup already claimed the invite atomically for this identity. Reload at the app root so
      // AuthProvider observes the new session without trying to redeem the now-consumed token.
      window.location.assign('/')
    } catch (error) {
      const transportFailure = error instanceof TypeError ||
        (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError'))
      if (transportFailure) {
        const signInResult = await authClient.signIn.email({ email: cleanEmail, password })
        if (!signInResult.error) {
          window.location.assign('/')
          return
        }
      }
      setState({
        kind: 'auth',
        message: transportFailure
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
          {state.kind === 'working' && (
            <p role="status" className="text-sm text-muted">
              {m.invite_joining()}
            </p>
          )}
          {state.kind === 'joined' && (
            <>
              <p role="status" className="text-sm font-medium text-ink">
                {`${m.invite_joined_base()}${state.role ? m.invite_joined_role({ role: state.role }) : ''}.`}
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
          )}
          {state.kind === 'error' && (
            <>
              <FieldError>{state.message}</FieldError>
              <div className="flex justify-end">
                <Link to="/" className={linkButtonClass}>
                  {m.invite_go_to_app()}
                </Link>
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
