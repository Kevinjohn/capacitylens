import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { API_BASE, isServerConfigured } from '../../data/apiConfig'
import { fetchAccountSummaries } from '../../auth/useAccountSummaries'
import { useStore } from '../../store/useStore'
import { FieldError } from '../common/ui'
import { linkButtonClass } from '../common/controls'
import { APP_NAME } from '@capacitylens/shared/brand'
import { m } from '@/i18n'

// Invite accept page (P1.9; route /invite/:token). On mount, in SERVER mode, it POSTs
// `${API_BASE}/api/invites/:token/accept` (credentials included so the session cookie rides along).
// The server is the authority: a valid link binds the invited role to the signed-in caller's
// membership; a used/expired/unknown link is refused. This page only renders the outcome — it never
// re-implements the single-use/expiry policy client-side.
//
// AUTH WALL: this route sits inside AuthProvider but OUTSIDE AppShell's tenant gate (see router.tsx),
// so an unauthenticated visit shows the LoginScreen first; after sign-in AuthProvider reloads onto
// the same /invite/:token URL and this page runs the accept POST with the now-present cookie.

type State =
  | { kind: 'working' }
  | { kind: 'joined'; accountId: string; role: string }
  | { kind: 'error'; message: string }
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
        const res = await fetch(`${API_BASE}/api/invites/${encodeURIComponent(token)}/accept`, {
          method: 'POST',
          credentials: 'include',
        })
        if (res.ok) {
          const body = (await res.json().catch(() => ({}))) as { accountId?: string; role?: string }
          // Switch the active company to the one just joined so the continue link lands in it.
          // This route mounts OUTSIDE AppShell, so useAccountSummaries hasn't run here: the joined
          // account is in neither `data.accounts` nor `accountSummaries`, and a bare setActiveAccount
          // would REJECT it as unknown (dropping to the picker with a spurious "company not found"
          // notice). Pull a fresh summaries list first and activate only once the account is in it.
          // A failed list read (null) skips activation — the Continue link then lands on the picker,
          // whose own summaries fetch (AppShell mount) lists the new membership. Fail-soft, no toast.
          if (typeof body.accountId === 'string') {
            const list = await fetchAccountSummaries()
            if (list !== null) {
              setAccountSummaries(list)
              if (list.some((a) => a.id === body.accountId)) setActiveAccount(body.accountId)
            }
          }
          setState({
            kind: 'joined',
            accountId: body.accountId ?? '',
            role: body.role ?? '',
          })
          return
        }
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setState({ kind: 'error', message: messageForStatus(res.status, body.error) })
      } catch (err) {
        // A pre-response transport error (server down, DNS, offline) — surface a generic, actionable
        // message rather than a dead end, and log the real cause for debugging.
        console.error('InviteAccept: accept request failed', err)
        setState({
          kind: 'error',
          message: m.invite_err_network(),
        })
      }
    })()
  }, [token, setActiveAccount, setAccountSummaries])

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
              <div className="flex justify-end">
                <Link to="/" className={linkButtonClass}>
                  {m.invite_continue()}
                </Link>
              </div>
            </>
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
