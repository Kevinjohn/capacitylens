import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { API_BASE, isServerConfigured } from '../data/apiConfig'
import { useStore } from '../store/useStore'
import { AuthContext, type AuthMode, type AuthUser } from './authContext'

// Auth boundary (production plan P3.3). In the demo build (VITE_CAPACITYLENS_DEMO=1) this is a
// pure pass-through that performs NO fetch at all. In server mode (the default) it asks
// GET /api/auth/me once at boot: authMode 'off' (the default deploy) renders the app
// exactly as today; a 401 replaces everything with the LoginScreen. The screen is a
// lazy chunk so better-auth's client never loads unless a login is actually shown.

const LoginScreen = lazy(() => import('./LoginScreen').then((m) => ({ default: m.LoginScreen })))

type Status =
  | { kind: 'checking' }
  | { kind: 'pass'; authMode: AuthMode; user: AuthUser | null; canCreateAccount: boolean; multiAccount: boolean }
  | { kind: 'login'; authMode: 'password' | 'sso'; needsSetup: boolean }

// A 'pass' Status that fails OPEN on the single-company-per-instance fields (see authContext.ts):
// used for every branch below that can't read a trustworthy canCreateAccount/multiAccount off the
// wire (an off-spec body, a non-401 non-ok response, or a network failure) — the server 403 remains
// the real enforcer, so "unknown" must never hide a legitimate "New company" affordance.
function passOpen(authMode: AuthMode, user: AuthUser | null): Status {
  return { kind: 'pass', authMode, user, canCreateAccount: true, multiAccount: true }
}

// Narrowing guards for the UNTRUSTED /api/auth/me response body (see fetchAuthStatus). The server
// is external input — we validate its shape rather than trusting an `as` cast.
function isAuthMode(v: unknown): v is AuthMode {
  return v === 'off' || v === 'password' || v === 'sso'
}
function isAuthUser(v: unknown): v is AuthUser {
  return typeof v === 'object' && v !== null && typeof (v as { id?: unknown }).id === 'string'
}
/** Reads a boolean field off the untrusted body, defaulting to `true` (fail-open) when it's
 *  absent or not a boolean — covers an older server that predates these fields as well as a
 *  malformed response. See `AuthContextValue.canCreateAccount` (authContext.ts) for why "unknown"
 *  means "allowed": the server 403 is the authoritative enforcer, this only gates a UI affordance. */
function boolFieldOr(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

/** Ask the server who we are. Total (never throws): a 401 maps to the login Status, a valid 200
 *  to a 'pass', and every UNRESOLVABLE shape — a non-401 non-ok response, an off-spec body, a
 *  network failure — returns `null` ("learned nothing trustworthy") so each caller picks its own
 *  degrade: boot fails OPEN to `passOpen('off', null)` (rendering the app beats a dead end; the
 *  ConnectionError / persistError surfaces describe a broken server better), while every
 *  mid-session re-check (`refreshAuth`, the persistError re-check) keeps the PREVIOUS snapshot
 *  (stale beats resetting a live session's user/authMode to 'off').
 *  Module-scope so the component's effects only subscribe to its result. */
async function fetchAuthStatus(): Promise<Status | null> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' })
    if (res.status === 401) {
      // The 401 body carries authMode so the login screen knows which form to show, plus the
      // first-run `needsSetup` signal (password mode + zero users on the server).
      const body = (await res.json().catch(() => ({}))) as { authMode?: string; needsSetup?: unknown }
      return {
        kind: 'login',
        authMode: body.authMode === 'sso' ? 'sso' : 'password',
        // FAIL-CLOSED: only a literal `true` (a server that computed "password mode + empty user
        // table") shows the owner-setup form — absent (an older server) or junk means the
        // ordinary sign-in, never a create-account form on a populated instance.
        needsSetup: body.needsSetup === true,
      }
    }
    if (res.ok) {
      // UNTRUSTED external input: a proxy HTML page, a truncated/old response, or a server bug could
      // yield a bogus authMode or a user with no id, which would otherwise flow straight into
      // AuthContext and the Settings gate. Validate before trusting; anything off-spec degrades to
      // 'off' (with a warn) rather than throwing — this runs during boot.
      const body: unknown = await res.json()
      const rawMode = (body as { authMode?: unknown } | null)?.authMode
      if (!isAuthMode(rawMode)) {
        console.warn('AuthProvider: /api/auth/me returned an unexpected authMode; nothing trustworthy learned', body)
        return null
      }
      const rawUser = (body as { user?: unknown } | null)?.user
      // Company-creation capability: the server computes both fields (canCreateAccount mirrors the
      // POST /api/orgs gate — the instance cap AND the caller's owner/admin standing), fail-open to
      // `true` when absent (an older server, or a response shape we don't recognise) — see
      // boolFieldOr and AuthContextValue.canCreateAccount.
      const canCreateAccount = boolFieldOr((body as { canCreateAccount?: unknown } | null)?.canCreateAccount, true)
      const multiAccount = boolFieldOr((body as { multiAccount?: unknown } | null)?.multiAccount, true)
      return {
        kind: 'pass',
        authMode: rawMode,
        user: isAuthUser(rawUser) ? rawUser : null,
        canCreateAccount,
        multiAccount,
      }
    }
    return null // non-401 non-ok: the server answered but told us nothing about the session
  } catch (err) {
    // Deliberate fallback: ANY failure to resolve /me (server down, DNS, CORS, offline, unreadable
    // body) reports null — "unresolved" — and the caller degrades (boot renders the APP rather
    // than a dead end; a refresh keeps its previous snapshot). Not silent: warn so the cause is
    // discoverable when debugging a flaky server.
    console.warn('AuthProvider: /api/auth/me check failed', err)
    return null
  }
}

/**
 * Boot-time auth boundary.
 *
 * - DEMO mode (VITE_CAPACITYLENS_DEMO=1): a pure pass-through — performs ZERO fetches, renders children.
 * - SERVER mode (the default): asks GET /api/auth/me ONCE at boot. authMode 'off' (the default deploy) renders
 *   the app as today; a 401 swaps in the lazy LoginScreen; any OTHER failure ALSO renders the app
 *   (deliberate — persistError / ConnectionError describe a broken server better than a dead end).
 * - Re-checks on `persistError` so an expired session (a 401 on a write) swaps to the login screen
 *   rather than letting writes keep failing silently behind the banner; an UNRESOLVED re-check
 *   keeps the previous snapshot (same policy as refreshAuth — see checkAuth).
 * - Exposes `refreshAuth` on the context so client actions that change what /me reports (org
 *   create/delete → a recomputed canCreateAccount) can re-ask mid-session instead of gating UI
 *   affordances on the boot-time snapshot.
 *
 * `authMode` comes ONLY from the server — there is no client-side auth flag. Don't "fix" the
 * failure-renders-app policy into a hard gate; it's intentional.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const serverMode = isServerConfigured()
  const [status, setStatus] = useState<Status>(
    // Demo build: no server, no cap — canCreateAccount/multiAccount fail open to true (passOpen).
    serverMode ? { kind: 'checking' } : passOpen('off', null),
  )
  const persistError = useStore((s) => s.persistError)

  // Ordering guard for EVERY setStatus-from-fetch path (boot, refreshAuth, the persistError
  // re-check): a monotonically increasing request id, captured when a /me fetch starts. Without it,
  // a slow, earlier request resolving LATE could overwrite a newer result — e.g. a stale
  // authenticated snapshot landing on top of a fresh 401 would hide the login screen and strand the
  // user on a dead session ("changes aren't saving") until a manual reload. Only the latest request
  // may write; a superseded result is simply dropped (the newer request already told the truth).
  const authRequestSeq = useRef(0)

  /** The ONE path from a /me fetch to setStatus, so no two checks can interleave badly (see
   *  `authRequestSeq`). `onNull` picks the degrade when the check resolves nothing trustworthy:
   *  - 'fail-open' (boot only — there IS no previous snapshot): render the app as auth-off; the
   *    persistError / ConnectionError surfaces describe a broken server better than a dead end.
   *  - 'keep-previous' (every mid-session re-check): keep the current snapshot with a warn
   *    breadcrumb — stale beats resetting a live session's user/authMode to 'off'. */
  const checkAuth = useCallback((onNull: 'fail-open' | 'keep-previous'): Promise<void> => {
    const requestId = ++authRequestSeq.current
    // .then (not await) so setStatus runs in a plain callback — the same shape as subscribing to
    // an external system, which is what this is (react-hooks/set-state-in-effect is happy with it).
    return fetchAuthStatus().then((next) => {
      if (requestId !== authRequestSeq.current) return // superseded by a newer check — drop, don't clobber
      if (next === null) {
        if (onNull === 'fail-open') {
          setStatus(passOpen('off', null))
        } else {
          console.warn('AuthProvider: /api/auth/me refresh failed; keeping the previous auth snapshot')
        }
        return
      }
      setStatus(next)
    })
  }, [])

  useEffect(() => {
    if (!serverMode) return // demo build: no auth request, ever
    // Boot degrade: an unresolved /me (null) fails OPEN to auth-off — rendering the app beats a
    // dead end here; the persistError / ConnectionError surfaces describe a broken server better.
    void checkAuth('fail-open')
  }, [serverMode, checkAuth])

  // Mid-session re-ask, exposed on the context as `refreshAuth` (see authContext.ts): the server
  // recomputes canCreateAccount per request from MUTABLE state (account count + membership roles),
  // so client actions that change that state (org create/delete in AccountPicker) call this to keep
  // the picker's affordances honest — e.g. deleting the only company must re-surface the "New
  // company" button (the zero-accounts bootstrap exemption) without a manual reload. TOTAL — never
  // rejects: an unresolved refresh keeps the PREVIOUS snapshot with a warn breadcrumb, mirroring
  // the fail-open posture above (the server 403 stays the real enforcer), so callers may safely
  // `void refreshAuth()`.
  const refreshAuth = useCallback(async () => {
    if (!serverMode) return // demo build: no server, the fields already fail open to true
    await checkAuth('keep-previous')
  }, [serverMode, checkAuth])

  // P3.4: a failing write raises the persistError banner; when the cause is an expired
  // session the re-check sees the 401 and swaps to the login screen, instead of letting
  // writes keep failing silently behind the banner. Same policy as refreshAuth: when the
  // re-check itself can't resolve /me (null) it KEEPS the current snapshot — a server outage
  // is exactly when /me is unreachable, and resetting a live authenticated session to
  // auth-off would drop the sign-out affordance and reshape member-management mid-outage,
  // with nothing to put it back until a manual reload (this effect only re-runs on
  // persistError transitions). Only a real answer (a 401, a fresh 'pass') changes state.
  useEffect(() => {
    if (!serverMode || !persistError) return
    void refreshAuth()
  }, [serverMode, persistError, refreshAuth])

  const signOut = useCallback(async () => {
    // A rejected sign-out — a network error, OR a failed dynamic import of the auth chunk after a
    // redeploy — must STILL land somewhere clean, never a stuck button with no feedback. So log the
    // cause but ALWAYS reload: the next boot re-checks /me and re-walls if the cookie is gone. Do
    // not swallow-and-skip the reload.
    try {
      const { authClient } = await import('./authClient')
      await authClient.signOut()
    } catch (e) {
      console.error('AuthProvider: sign-out failed; reloading to re-resolve the session', e)
    } finally {
      // Full restart: in-memory data must not outlive the session, and the boot path
      // (bootstrap + this provider's check) lands cleanly on the login screen (or re-walls).
      window.location.reload()
    }
  }, [])

  if (status.kind === 'checking') return null
  if (status.kind === 'login') {
    // Pre-session carve-out (P1.18): /reset-password/:token must render WITHOUT a session — the
    // visitor redeeming an admin-issued reset link is exactly the person who cannot sign in (the
    // login wall would be a dead end). The page is as safe as LoginScreen itself: it renders no
    // tenant data and only POSTs the public /api/auth/reset-password endpoint (which requireUser
    // already exempts server-side). window.location (not router state) is correct here — this
    // component sits ABOVE the router, and the page's only exit is a full page load (see
    // ResetPassword), so the path can't go stale mid-session. No AuthContext is provided on this
    // branch; ResetPassword deliberately consumes none.
    //
    // Match EXACTLY one non-empty, non-nested segment — the shape `/reset-password/:token` the router
    // actually renders. A malformed link (a token truncated to `/reset-password/`, or a trailing
    // `/reset-password/<token>/extra`) matches NO route, so carving it out of the wall would drop the
    // visitor onto React Router's bare 404 dead-end; failing the match here instead keeps the login
    // wall as the fallback (a styled screen with a way in), which is the safer degrade.
    if (/^\/reset-password\/[^/]+$/.test(window.location.pathname)) return <>{children}</>
    return (
      <Suspense fallback={null}>
        {/* Reload on success: bootstrap already ran (and 401ed) without a session, so a
            clean boot re-hydrates from the server WITH the new cookie and re-attaches
            persistence — state-juggling here would re-implement main.tsx. */}
        <LoginScreen
          authMode={status.authMode}
          needsSetup={status.needsSetup}
          onSignedIn={() => window.location.reload()}
        />
      </Suspense>
    )
  }
  return (
    <AuthContext.Provider
      value={{
        authMode: status.authMode,
        user: status.user,
        canCreateAccount: status.canCreateAccount,
        multiAccount: status.multiAccount,
        refreshAuth,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
