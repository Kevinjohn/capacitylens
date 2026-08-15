import { createContext, useContext } from "react";

// Auth context (production plan P3.3), separate from AuthProvider so component files
// export only components (react-refresh) and consumers (SettingsView) don't import the
// provider machinery. The server's reported authMode is the single source of truth —
// there is NO client-side auth flag; the default below is what the demo build and an
// auth-off server both resolve to, so consumers rendered without a provider (unit
// tests, storybook-style isolation) behave exactly like today's app.

export type AuthMode = "off" | "password" | "sso";

export interface AuthUser {
  id: string;
  name?: string;
  email?: string;
  twoFactorEnabled?: boolean;
  /** IdP-asserted avatar URL (OIDC `picture`), https-validated server-side. `null`/absent when the
   *  provider carries no picture; only the signed-in user's own avatar is ever surfaced. */
  image?: string | null;
}

interface AuthProviderBase {
  label: string;
  experimental: boolean;
}

export const SUPPORTED_SOCIAL_PROVIDER_IDS = ["google", "microsoft", "github"] as const;
export type SupportedSocialProviderId = (typeof SUPPORTED_SOCIAL_PROVIDER_IDS)[number];
const supportedSocialProviderIds: ReadonlySet<string> = new Set(SUPPORTED_SOCIAL_PROVIDER_IDS);

export function isSupportedSocialProviderId(value: unknown): value is SupportedSocialProviderId {
  return typeof value === "string" && supportedSocialProviderIds.has(value);
}

export type AuthProviderInfo =
  | (AuthProviderBase & { id: SupportedSocialProviderId; kind: "social" })
  | (AuthProviderBase & { id: string; kind: "oidc" });

/**
 * The one NON-experimental OIDC provider, or `null`.
 *
 * "Strict" = a real, generally-available enterprise IdP: `kind === 'oidc'` AND `experimental` false.
 * Several surfaces (Settings → Members' SSO-readiness panel, Settings → Security's identity-provider
 * link) gate themselves on that fact, and each of them held its own copy of the same
 * `providers?.find(...) ?? null`. Single-sourced here, beside {@link isSupportedSocialProviderId},
 * so "which provider counts as the strict one" cannot drift between the surfaces that ask.
 *
 * FIRST match wins, deliberately: the server publishes at most one strict OIDC provider today, and
 * taking the first keeps this byte-identical to the inline finds it replaces rather than inventing a
 * multi-provider rule the callers have no UI for.
 *
 * @param providers - the context's `providers` list exactly as components hold it; `undefined`/`null`
 *                    (no provider metadata yet, or no provider at all) yields `null`, not a throw.
 * @returns the first strict OIDC provider, or `null` when there is none.
 */
export function strictOidcProvider(providers: readonly AuthProviderInfo[] | null | undefined): AuthProviderInfo | null {
  return providers?.find((provider) => provider.kind === "oidc" && !provider.experimental) ?? null;
}

export interface AuthContextValue {
  authMode: AuthMode;
  user: AuthUser | null;
  /** Configured public provider metadata. Needed by pre-session invite and re-authentication
   * surfaces so they use the same server-owned provider list as the ordinary login wall. */
  providers?: readonly AuthProviderInfo[];
  /** May the UI offer to create ANOTHER company? Mirrors the server's POST /api/orgs gate — the
   *  single-company-per-instance cap AND the caller's standing (auth-on: an active owner/admin
   *  somewhere, or first-run bootstrap). The SERVER stays the authoritative enforcer (the create
   *  POST still 403s) — this only hides the "New company" affordance. FAIL-OPEN default `true`
   *  whenever the fact is unavailable (demo build, a fetch failure, a 401/503 response, or an
   *  older server that predates these fields), so a client-side unknown never hides a legitimate
   *  affordance; the server 403 is the real backstop. */
  canCreateAccount: boolean;
  /** Mirrors the server's `CAPACITYLENS_MULTI_ACCOUNT` flag. Informational only — `canCreateAccount`
   *  is the one gating decision (it also covers the zero-accounts bootstrap exemption); this exists
   *  because it costs nothing to carry alongside it. Same fail-open `true` default as above. */
  multiAccount: boolean;
  /** Re-asks GET /api/auth/me mid-session. The server recomputes `canCreateAccount` per request
   *  from MUTABLE state (account count + the caller's membership roles), so a client action that
   *  changes that state — creating or deleting a company — must call this or the picker gates its
   *  affordances on a stale boot-time snapshot (deleting the only company would otherwise strand
   *  the user on an empty state with no "New company" button until a manual reload). TOTAL: never
   *  rejects — an unresolved refresh keeps the previous snapshot with a `console.warn` breadcrumb
   *  (fail-open; the server 403 stays the real enforcer), so `void refreshAuth()` is safe to
   *  fire-and-forget. No-op in the demo build and in the providerless default below. */
  refreshAuth: () => Promise<void>;
  /** Ends the Better Auth session and restarts the app. Never surfaced when authMode is 'off'. */
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue>({
  authMode: "off",
  user: null,
  providers: [],
  canCreateAccount: true,
  multiAccount: true,
  refreshAuth: async () => {},
  signOut: async () => {},
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
