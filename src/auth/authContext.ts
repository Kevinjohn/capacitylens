import { createContext, useContext } from 'react'

// Auth context (production plan P3.3), separate from AuthProvider so component files
// export only components (react-refresh) and consumers (SettingsView) don't import the
// provider machinery. The server's reported authMode is the single source of truth —
// there is NO client-side auth flag; the default below is what the demo build and an
// auth-off server both resolve to, so consumers rendered without a provider (unit
// tests, storybook-style isolation) behave exactly like today's app.

export type AuthMode = 'off' | 'password' | 'sso'

export interface AuthUser {
  id: string
  name?: string
  email?: string
}

export interface AuthContextValue {
  authMode: AuthMode
  user: AuthUser | null
  /** May the UI offer to create ANOTHER company? Single-company-per-instance policy: the SERVER
   *  is the authoritative enforcer (a direct `POST /api/accounts` beyond the first still 403s
   *  when its `CAPACITYLENS_MULTI_ACCOUNT` flag is off) — this only hides the "New company"
   *  affordance. FAIL-OPEN default `true` whenever the fact is unavailable (demo build, a fetch
   *  failure, a 401/503 response, or an older server that predates these fields), so a client-side
   *  unknown never hides a legitimate affordance; the server 403 is the real backstop. */
  canCreateAccount: boolean
  /** Mirrors the server's `CAPACITYLENS_MULTI_ACCOUNT` flag. Informational only — `canCreateAccount`
   *  is the one gating decision (it also covers the zero-accounts bootstrap exemption); this exists
   *  because it costs nothing to carry alongside it. Same fail-open `true` default as above. */
  multiAccount: boolean
  /** Ends the Better Auth session and restarts the app. Never surfaced when authMode is 'off'. */
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue>({
  authMode: 'off',
  user: null,
  canCreateAccount: true,
  multiAccount: true,
  signOut: async () => {},
})

export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}
