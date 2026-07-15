// Better Auth's React client, in its own module so it is ONLY ever loaded on demand:
// LoginScreen (itself a lazy chunk) imports it statically, and AuthProvider.signOut
// dynamic-imports it inside the click handler. The demo build and auth-off deploys never
// evaluate this file — better-auth stays out of the main bundle and no auth code runs.

import { createAuthClient } from 'better-auth/react'
import { genericOAuthClient, twoFactorClient } from 'better-auth/client/plugins'
import { API_BASE } from '../data/apiConfig'

// Same-origin by default: an empty API_BASE is now the NORMAL case (server persistence defaults to
// the same origin), so fall back to window.location.origin rather than leaving a bare `/api/auth`
// with no origin. This module is still only ever loaded on demand from LoginScreen /
// AuthProvider.signOut, and never loads in the in-memory demo build.
export const authClient = createAuthClient({
  baseURL: `${API_BASE || window.location.origin}/api/auth`,
  // The generic OAuth2/OIDC client mirrors the server's sso mode (provider stays config).
  plugins: [genericOAuthClient(), twoFactorClient()],
})
