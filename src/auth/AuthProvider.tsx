import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { API_BASE, isServerConfigured } from '../data/apiConfig'
import { useStore } from '../store/useStore'
import { AuthContext, type AuthMode, type AuthUser } from './authContext'

// Auth boundary (production plan P3.3). In LOCAL mode (no VITE_FLOATY_API) this is a
// pure pass-through that performs NO fetch at all. In server mode it asks
// GET /api/auth/me once at boot: authMode 'off' (the default deploy) renders the app
// exactly as today; a 401 replaces everything with the LoginScreen. The screen is a
// lazy chunk so better-auth's client never loads unless a login is actually shown.

const LoginScreen = lazy(() => import('./LoginScreen').then((m) => ({ default: m.LoginScreen })))

type Status =
  | { kind: 'checking' }
  | { kind: 'pass'; authMode: AuthMode; user: AuthUser | null }
  | { kind: 'login'; authMode: 'password' | 'sso' }

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
      const body = (await res.json()) as { authMode: AuthMode; user: AuthUser | null }
      return { kind: 'pass', authMode: body.authMode, user: body.user }
    }
    return { kind: 'pass', authMode: 'off', user: null }
  } catch {
    return { kind: 'pass', authMode: 'off', user: null }
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const serverMode = isServerConfigured()
  const [status, setStatus] = useState<Status>(
    serverMode ? { kind: 'checking' } : { kind: 'pass', authMode: 'off', user: null },
  )
  const persistError = useStore((s) => s.persistError)

  useEffect(() => {
    if (!serverMode) return // local mode: no auth request, ever
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
    const { authClient } = await import('./authClient')
    await authClient.signOut()
    // Full restart: in-memory data must not outlive the session, and the boot path
    // (bootstrap + this provider's check) lands cleanly on the login screen.
    window.location.reload()
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
