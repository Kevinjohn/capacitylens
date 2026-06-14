// Better Auth's React client, in its own module so it is ONLY ever loaded on demand:
// LoginScreen (itself a lazy chunk) imports it statically, and AuthProvider.signOut
// dynamic-imports it inside the click handler. Local mode and auth-off deploys never
// evaluate this file — better-auth stays out of the main bundle and no auth code runs.

import { createAuthClient } from 'better-auth/react'
import { genericOAuthClient } from 'better-auth/client/plugins'
import { API_BASE } from '../data/apiConfig'

// ASSUMES SERVER MODE: API_BASE is non-empty here. This module is only ever loaded on demand from
// LoginScreen / AuthProvider.signOut, both of which only run in server mode — so an empty baseURL
// can't occur in practice. If a future change statically imports this elsewhere, guard that
// API_BASE is set first (a client pointed at `/api/auth` with no origin would silently misbehave).
export const authClient = createAuthClient({
  baseURL: `${API_BASE}/api/auth`,
  // The generic OAuth2/OIDC client mirrors the server's sso mode (provider stays config).
  plugins: [genericOAuthClient()],
})
