// The auth client must stay behind lazy authentication entry points so the interactive library does not enter the initial bundle.

import { createAuthClient } from "better-auth/react";
import { API_BASE } from "@/data/apiConfig";

// The auth client needs an absolute origin, so the same-origin configuration resolves API_BASE through window.location.origin.
/** Better Auth browser client configured for the application API origin. */
export const authClient = createAuthClient({
  baseURL: `${API_BASE || window.location.origin}/api/auth`,
});
