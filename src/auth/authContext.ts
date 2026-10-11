import { createContext, useContext } from "react";

// Share the server-owned auth mode with screens without importing provider code.

export type { AccountMode } from "@capacitylens/shared/account/types";
import type { AccountMode } from "@capacitylens/shared/account/types";

/** @deprecated Prefer the provider-neutral AccountMode. */
export type AuthMode = AccountMode;

/** Verified user identity exposed to authenticated application screens. */
export interface AuthUser {
  id: string;
  name?: string;
  email?: string;
  /** IdP-asserted avatar URL (OIDC `picture`), https-validated server-side. `null`/absent when the
   * provider carries no picture; only the signed-in user's own avatar is ever surfaced. */
  image?: string | null;
}

interface AuthProviderBase {
  label: string;
  experimental: boolean;
  /** Server-owned presentation hint. Optional only for compatibility with older servers. */
  brand?: AuthProviderBrand;
}

/** Brand used to label a configured social sign-in provider. */
export type AuthProviderBrand = "generic" | "google" | "microsoft";

/** Social provider IDs the client recognises from server metadata. */
export const SUPPORTED_SOCIAL_PROVIDER_IDS = ["google", "microsoft", "github"] as const;
/** Provider ID accepted by social sign-in flows. */
export type SupportedSocialProviderId = (typeof SUPPORTED_SOCIAL_PROVIDER_IDS)[number];
const supportedSocialProviderIds: ReadonlySet<string> = new Set(SUPPORTED_SOCIAL_PROVIDER_IDS);

/** Checks whether an untrusted provider ID is supported by the client. */
export function isSupportedSocialProviderId(value: unknown): value is SupportedSocialProviderId {
  return typeof value === "string" && supportedSocialProviderIds.has(value);
}

/** Configured social provider metadata used by sign-in and linking screens. */
export type AuthProviderInfo = AuthProviderBase & { id: SupportedSocialProviderId; kind: "social" };

export function hasGoogleProviderBrand(provider: Pick<AuthProviderInfo, "id" | "kind" | "brand">): boolean {
  return provider.brand === "google" || (provider.brand === undefined && provider.id === "google");
}

/** Authentication state, provider options, and actions available to app screens. */
export interface AuthContextValue {
  authMode: AccountMode;
  user: AuthUser | null;
  /** Configured public provider metadata. Needed by pre-session invite and re-authentication
   * surfaces so they use the same server-owned provider list as the ordinary login wall. */
  providers?: readonly AuthProviderInfo[];
  /** May the UI offer to create another company? Mirrors the server's POST /api/orgs gate, the
   * single-company-per-instance cap and the caller's standing (auth-on: an active owner/admin
   * somewhere, or first-run bootstrap). The server stays the authoritative enforcer (the create
   * POST still 403s). This only hides the "New company" affordance. Fail-open default `true`
   * whenever the fact is unavailable (demo build, a fetch failure, a 401/503 response, or an
   * older server that predates these fields), so a client-side unknown never hides a legitimate
   * affordance; the server 403 is the real backstop. */
  canCreateAccount: boolean;
  /** Mirrors the server's `CAPACITYLENS_MULTI_ACCOUNT` flag. Informational only, `canCreateAccount`
   * is the one gating decision (it also covers the zero-accounts bootstrap exemption); this exists
   * because it costs nothing to carry alongside it. Same fail-open `true` default as above. */
  multiAccount: boolean;
  /** Current identity's method for fresh authentication. */
  reauthMethod?: "password" | "provider";
  /** Re-asks GET /api/auth/me mid-session. The server recomputes `canCreateAccount` per request
   * from mutable state (account count + the caller's membership roles), so a client action that
   * changes that state, creating or deleting a company, must call this or the picker gates its
   * affordances on a stale boot-time snapshot (deleting the only company would otherwise strand
   * the user on an empty state with no "New company" button until a manual reload). Total: never
   * rejects, an unresolved refresh keeps the previous snapshot with a `console.warn` breadcrumb
   * (fail-open; the server 403 stays the real enforcer), so `void refreshAuth()` is safe to
   * fire-and-forget. No-op in the demo build and in the providerless default below. */
  refreshAuth: () => Promise<void>;
  /** Ends the Better Auth session and restarts the app. Never surfaced when authMode is 'off'. */
  signOut: () => Promise<void>;
}

/** Context supplying authentication state to the application. */
export const AuthContext = createContext<AuthContextValue>({
  authMode: "off",
  user: null,
  providers: [],
  canCreateAccount: true,
  multiAccount: true,
  refreshAuth: async () => {},
  signOut: async () => {},
});

/** Reads authentication state and actions from the nearest auth provider. */
export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
