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
  /** Ends the Better Auth session and restarts the app. Never surfaced when authMode is 'off'. */
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue>({
  authMode: 'off',
  user: null,
  signOut: async () => {},
})

export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}
