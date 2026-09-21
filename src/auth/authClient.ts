// Better Auth's React client, isolated so it is loaded only through auth-specific lazy chunks.
// Its static importers (LoginScreen, ReauthDialog and MfaEnrollmentScreen) are all React.lazy
// boundaries in AuthProvider. Keep every future importer behind an equivalent boundary so
// better-auth stays out of the main bundle until an interactive auth flow needs it.

import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";
import { API_BASE } from "../data/apiConfig";

// Same-origin by default: an empty API_BASE is now the NORMAL case (server persistence defaults to
// the same origin), so fall back to window.location.origin rather than leaving a bare `/api/auth`
// with no origin. The lazy-import invariant above keeps this module out of the initial app chunk.
export const authClient = createAuthClient({
  baseURL: `${API_BASE || window.location.origin}/api/auth`,
  plugins: [twoFactorClient()],
});
