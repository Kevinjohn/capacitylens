import type { Auth, SessionUser } from './auth'

// P0.5.8: the provider-neutral session-verify port. Everything ABOVE auth (app.ts's
// requireUser preHandler + GET /api/auth/me) depends ONLY on this interface, never on
// Better Auth directly — so Phase 1 can swap the backend without touching the app. The
// default implementation (betterAuthAdapter) wraps a Better Auth instance; nothing else
// changes. (SessionUser keeps its current shape; it is widened separately in P1.7a.)

/**
 * Verifies an HTTP request's session, expressed in web-standard `Headers` so the port
 * stays decoupled from any framework's header type and from Better Auth's generics.
 *
 * The null-vs-throw split is the LOAD-BEARING invariant — callers distinguish three
 * outcomes and map them to different HTTP statuses:
 *  - a VALID session  → resolves the {@link SessionUser};
 *  - NO session       → resolves `null` (the caller answers 401 "sign in to continue");
 *  - backend FAILURE  → THROWS (the auth backend / its DB is unreachable or broke). This
 *    is NOT "no session": callers catch it and answer 503 (distinct from the 401 case),
 *    so an unauthenticated request is never served. Implementations MUST let backend
 *    errors propagate — do NOT swallow them or collapse them to `null` (that would turn a
 *    503 into a silent 401, hiding an outage and degrading the security signal).
 */
export interface AuthAdapter {
  verifySession(headers: Headers): Promise<SessionUser | null>
}

/**
 * Default {@link AuthAdapter}: wraps a Better Auth {@link Auth} instance. `getSession`
 * returns `{ user }` for a valid session or `null` for none, so `?.user ?? null` maps
 * exactly onto the port's session/null contract. Backend errors are deliberately NOT
 * caught here — `getSession` throwing (auth DB down, etc.) propagates so the caller can
 * map it to a 503, per the {@link AuthAdapter} contract.
 */
export function betterAuthAdapter(auth: Auth): AuthAdapter {
  return {
    async verifySession(headers: Headers): Promise<SessionUser | null> {
      return (await auth.api.getSession({ headers }))?.user ?? null
    },
  }
}
