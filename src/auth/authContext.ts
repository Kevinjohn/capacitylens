import { createContext, useContext } from "react";

// Auth context (production plan P3.3), separate from AuthProvider so component files
// export only components (react-refresh) and consumers (SettingsView) don't import the
// provider machinery. The server's reported authMode is the single source of truth —
// there is NO client-side auth flag; the default below is what the demo build and an
// auth-off server both resolve to, so consumers rendered without a provider (unit
// tests, storybook-style isolation) behave exactly like today's app.

export type { AccountMode } from "@capacitylens/shared/account/types";
import type { AccountMode } from "@capacitylens/shared/account/types";

/** @deprecated Prefer the provider-neutral AccountMode. */
export type AuthMode = AccountMode;

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
  /** Server-owned presentation hint. Optional only for compatibility with older servers. */
  brand?: AuthProviderBrand;
}

export type AuthProviderBrand = "generic" | "google" | "microsoft";

export const SUPPORTED_SOCIAL_PROVIDER_IDS = ["google", "microsoft", "github"] as const;
export type SupportedSocialProviderId = (typeof SUPPORTED_SOCIAL_PROVIDER_IDS)[number];
const supportedSocialProviderIds: ReadonlySet<string> = new Set(SUPPORTED_SOCIAL_PROVIDER_IDS);

export function isSupportedSocialProviderId(value: unknown): value is SupportedSocialProviderId {
  return typeof value === "string" && supportedSocialProviderIds.has(value);
}

export type AuthProviderInfo = AuthProviderBase & { id: SupportedSocialProviderId; kind: "social" };

export function hasGoogleProviderBrand(provider: Pick<AuthProviderInfo, "id" | "kind" | "brand">): boolean {
  return provider.brand === "google" || (provider.brand === undefined && provider.id === "google");
}

export interface AuthContextValue {
  authMode: AccountMode;
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
  /** Operator policy, distinct from an unfinished MFA enrollment challenge. */
  requireMfa?: boolean;
  /** Current identity's method for fresh authentication. */
  reauthMethod?: "password" | "provider";
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
