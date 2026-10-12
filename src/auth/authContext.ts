import { createContext, useContext } from "react";

export type { AccountMode } from "@capacitylens/shared/account/types";
import type { AccountMode } from "@capacitylens/shared/account/types";

/** @deprecated Prefer the provider-neutral AccountMode. */
export type AuthMode = AccountMode;

/** Verified user identity exposed to authenticated application screens. */
export interface AuthUser {
  id: string;
  name?: string;
  email?: string;
  /** The signed-in identity's provider image URL, validated server-side; absent when the provider supplies no image. */
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

/** Returns whether the provider uses Google branding, using its legacy ID only when brand is absent. */
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
  /** Whether company creation is available under current server policy. Unavailable capability metadata keeps the affordance visible; the server independently authorizes the request. */
  canCreateAccount: boolean;
  /** The server multi-account setting is informational; canCreateAccount is the affordance decision and includes first-run creation. */
  multiAccount: boolean;
  /** Current identity's method for fresh authentication. */
  reauthMethod?: "password" | "provider";
  /** Rechecks server-owned authentication and company-creation capability. Unresolved refreshes preserve the previous snapshot and log a warning; the promise does not reject, so event callers may discard it. */
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
