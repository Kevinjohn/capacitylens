import { isSupportedSocialProviderId } from "./authContext";
import type { AccountMode, AuthProviderBrand, AuthProviderInfo, AuthUser } from "./authContext";
import { hasDuplicateIdentity } from "@/lib/hasDuplicateIdentity";

/** Possible outcomes while resolving the current auth mode and user access. */
export type AuthStatusResult =
  | { kind: "checking" }
  | { kind: "error"; message: string }
  | {
      kind: "pass";
      /** Identifies whether tenant access was confirmed by a live session, cached offline, or opened without auth. */
      identitySource?: "live" | "offline" | "open";
      authMode: AccountMode;
      user: AuthUser | null;
      canCreateAccount: boolean;
      multiAccount: boolean;
      providers: AuthProviderInfo[];
      reauthMethod: "password" | "provider";
      reauthProviderId: string | null;
    }
  | {
      kind: "login";
      passwordResetEmail: boolean;
      authMode: Exclude<AccountMode, "off">;
      needsSetup: boolean;
      providers: AuthProviderInfo[];
      /** True when the 401 body itself was untrustworthy (non-JSON, an HTML proxy page, or a
       * junk `authMode` value), as opposed to a well-formed body that simply predates a field
       * (an older server omitting `providers`) or explicitly selects password/SSO. The login
       * wall uses this to show a non-terminal "configuration couldn't be loaded" notice above
       * the password fallback, so an SSO-only instance behind a broken proxy doesn't strand the
       * user on a bare, unexplained password form. See DECISIONS.md's 401 sign-in-wall entry. */
      degraded: boolean;
      /** Captured synchronously at the 401 boundary, before replacing the app detaches persistence. */
      hadUnsavedChanges: boolean;
    };

// Demo/open entry uses permissive creation defaults; an unreadable live-auth response remains behind the retryable authentication error boundary.
/** Builds the auth result used when server access metadata is unavailable. */
export function buildOpenAuthResult(authMode: AccountMode, user: AuthUser | null): AuthStatusResult {
  return {
    kind: "pass",
    identitySource: "open",
    authMode,
    user,
    canCreateAccount: true,
    multiAccount: true,
    providers: [],
    reauthMethod: "password",
    reauthProviderId: null,
  };
}

/** Checks whether an untrusted value is a supported account auth mode. */
export function isAuthMode(value: unknown): value is AccountMode {
  return value === "off" || value === "password-only" || value === "sso-only" || value === "password-and-sso";
}
type AuthProviderCandidate = Omit<AuthProviderInfo, "brand"> & { brand?: unknown };

function isAuthProvider(value: unknown): value is AuthProviderCandidate {
  if (typeof value !== "object" || value === null) return false;
  const provider = value as Record<string, unknown>;
  return (
    typeof provider.id === "string" &&
    provider.id.length > 0 &&
    typeof provider.label === "string" &&
    provider.label.length > 0 &&
    provider.kind === "social" &&
    isSupportedSocialProviderId(provider.id) &&
    typeof provider.experimental === "boolean"
  );
}

const SOCIAL_PROVIDER_BRANDS: Record<string, AuthProviderBrand> = { google: "google" };

function parseProviderBrand(provider: AuthProviderCandidate): AuthProviderBrand {
  return SOCIAL_PROVIDER_BRANDS[provider.id] ?? "generic";
}

/** Validates and normalises provider metadata from the auth status response. */
export function parseAuthProviders(value: unknown): AuthProviderInfo[] {
  if (!Array.isArray(value)) return [];
  const providers: AuthProviderInfo[] = [];
  for (const candidate of value) {
    if (isAuthProvider(candidate)) {
      providers.push({ ...candidate, brand: parseProviderBrand(candidate) });
      continue;
    }
    const record = candidate && typeof candidate === "object" ? (candidate as Record<string, unknown>) : null;
    const candidateId = record?.id;
    const summary = record
      ? {
          id: typeof candidateId === "string" ? candidateId.slice(0, 128) : "[invalid]",
          kind: typeof record.kind === "string" ? record.kind.slice(0, 32) : typeof record.kind,
        }
      : { id: "[invalid]", kind: typeof candidate };
    console.warn("AuthProvider: dropped an unsupported or malformed /api/auth/me provider", summary);
  }
  if (hasDuplicateIdentity(providers, (provider) => `${provider.kind}:${provider.id}`)) {
    console.warn("AuthProvider: /api/auth/me returned duplicate provider identities; ignoring the provider list");
    return [];
  }
  return providers;
}

type ResolveBooleanFieldOptions = { value: unknown; fallback: boolean };
/** Unknown boolean metadata uses the supplied compatibility fallback because the server remains authoritative for creation permission. */
export function resolveBooleanField({ value, fallback }: ResolveBooleanFieldOptions): boolean {
  return typeof value === "boolean" ? value : fallback;
}
