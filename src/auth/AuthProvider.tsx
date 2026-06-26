import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
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
  | { kind: 'pass'; authMode: AuthMode; user: AuthUser | null }
  | { kind: 'login'; authMode: 'password' | 'sso' }

// Narrowing guards for the UNTRUSTED /api/auth/me response body (see fetchAuthStatus). The server
// is external input — we validate its shape rather than trusting an `as` cast.
function isAuthMode(v: unknown): v is AuthMode {
  return v === 'off' || v === 'password' || v === 'sso'
}
function isAuthUser(v: unknown): v is AuthUser {
  return typeof v === 'object' && v !== null && typeof (v as { id?: unknown }).id === 'string'
}

/** Ask the server who we are. Total: every failure shape maps to a Status — a 401 means
 *  the login screen; anything else renders the app (the existing ConnectionError /
 *  persistError surfaces describe a broken or unreachable server better than a dead end
 *  here would). Module-scope so the component's effects only subscribe to its result. */
async function fetchAuthStatus(): Promise<Status> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' })
    if (res.status === 401) {
      // The 401 body carries authMode so the login screen knows which form to show.
      const body = (await res.json().catch(() => ({}))) as { authMode?: string }
      return { kind: 'login', authMode: body.authMode === 'sso' ? 'sso' : 'password' }
    }
    if (res.ok) {
      // UNTRUSTED external input: a proxy HTML page, a truncated/old response, or a server bug could
      // yield a bogus authMode or a user with no id, which would otherwise flow straight into
      // AuthContext and the Settings gate. Validate before trusting; anything off-spec degrades to
      // 'off' (with a warn) rather than throwing — this runs during boot.
      const body: unknown = await res.json()
      const rawMode = (body as { authMode?: unknown } | null)?.authMode
      if (!isAuthMode(rawMode)) {
        console.warn('AuthProvider: /api/auth/me returned an unexpected authMode; treating as off', body)
        return { kind: 'pass', authMode: 'off', user: null }
      }
      const rawUser = (body as { user?: unknown } | null)?.user
      return { kind: 'pass', authMode: rawMode, user: isAuthUser(rawUser) ? rawUser : null }
    }
    return { kind: 'pass', authMode: 'off', user: null }
  } catch (err) {
    // Deliberate fallback: ANY failure to resolve /me (server down, DNS, CORS, offline, unreadable
    // body) renders the APP rather than a dead end — the persistError / ConnectionError surfaces
    // describe a broken/unreachable server better than blocking here would. Not silent: warn so the
    // cause is discoverable when debugging a flaky server.
    console.warn('AuthProvider: /api/auth/me check failed; rendering the app as auth-off', err)
    return { kind: 'pass', authMode: 'off', user: null }
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
 *   rather than letting writes keep failing silently behind the banner.
 *
 * `authMode` comes ONLY from the server — there is no client-side auth flag. Don't "fix" the
 * failure-renders-app policy into a hard gate; it's intentional.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const serverMode = isServerConfigured()
  const [status, setStatus] = useState<Status>(
    serverMode ? { kind: 'checking' } : { kind: 'pass', authMode: 'off', user: null },
  )
  const persistError = useStore((s) => s.persistError)

  useEffect(() => {
    if (!serverMode) return // demo build: no auth request, ever
    void fetchAuthStatus().then(setStatus)
  }, [serverMode])

  // P3.4: a failing write raises the persistError banner; when the cause is an expired
  // session the re-check sees the 401 and swaps to the login screen, instead of letting
  // writes keep failing silently behind the banner. A mere network blip re-checks too,
  // fails the same way, and changes nothing.
  useEffect(() => {
    if (!serverMode || !persistError) return
    void fetchAuthStatus().then(setStatus)
  }, [serverMode, persistError])

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
    return (
      <Suspense fallback={null}>
        {/* Reload on success: bootstrap already ran (and 401ed) without a session, so a
            clean boot re-hydrates from the server WITH the new cookie and re-attaches
            persistence — state-juggling here would re-implement main.tsx. */}
        <LoginScreen authMode={status.authMode} onSignedIn={() => window.location.reload()} />
      </Suspense>
    )
  }
  return (
    <AuthContext.Provider value={{ authMode: status.authMode, user: status.user, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
