import { isSupportedSocialProviderId, type AuthMode, type AuthProviderInfo, type AuthUser } from "./authContext";
import { hasDuplicateIdentity } from "../lib/hasDuplicateIdentity";

export type AuthStatusResult =
  | { kind: "checking" }
  | { kind: "error"; message: string }
  | {
      kind: "pass";
      authMode: AuthMode;
      user: AuthUser | null;
      canCreateAccount: boolean;
      multiAccount: boolean;
      mfaRequired: boolean;
      providers: AuthProviderInfo[];
      reauthMethod: "password" | "provider";
      reauthProviderId: string | null;
    }
  | {
      kind: "login";
      authMode: "password" | "sso";
      needsSetup: boolean;
      providers: AuthProviderInfo[];
      /** True when the 401 body itself was untrustworthy (non-JSON, an HTML proxy page, or a
       *  junk `authMode` value) — as opposed to a well-formed body that simply predates a field
       *  (an older server omitting `providers`) or explicitly selects password/SSO. The login
       *  wall uses this to show a non-terminal "configuration couldn't be loaded" notice above
       *  the password fallback, so an SSO-only instance behind a broken proxy doesn't strand the
       *  user on a bare, unexplained password form. See DECISIONS.md's 401 sign-in-wall entry. */
      degraded: boolean;
      /** Captured synchronously at the 401 boundary, before replacing the app detaches persistence. */
      hadUnsavedChanges: boolean;
    };

// A 'pass' Status that fails OPEN on the single-company-per-instance fields (see authContext.ts):
// used for every branch below that can't read a trustworthy canCreateAccount/multiAccount off the
// wire (an off-spec body, a non-401 non-ok response, or a network failure) — the server 403 remains
// the real enforcer, so "unknown" must never hide a legitimate "New company" affordance.
export function buildOpenAuthResult(authMode: AuthMode, user: AuthUser | null): AuthStatusResult {
  return {
    kind: "pass",
    authMode,
    user,
    canCreateAccount: true,
    multiAccount: true,
    mfaRequired: false,
    providers: [],
    reauthMethod: "password",
    reauthProviderId: null,
  };
}

// Narrowing guards for the UNTRUSTED /api/auth/me response body (see fetchAuthStatus). The server
// is external input — we validate its shape rather than trusting an `as` cast.
export function isAuthMode(value: unknown): value is AuthMode {
  return value === "off" || value === "password" || value === "sso";
}
function isAuthProvider(value: unknown): value is AuthProviderInfo {
  if (typeof value !== "object" || value === null) return false;
  const provider = value as Record<string, unknown>;
  return (
    typeof provider.id === "string" &&
    provider.id.length > 0 &&
    typeof provider.label === "string" &&
    provider.label.length > 0 &&
    (provider.kind === "oidc" || (provider.kind === "social" && isSupportedSocialProviderId(provider.id))) &&
    typeof provider.experimental === "boolean"
  );
}

export function parseAuthProviders(value: unknown): AuthProviderInfo[] {
  if (!Array.isArray(value)) return [];
  const providers: AuthProviderInfo[] = [];
  for (const candidate of value) {
    if (isAuthProvider(candidate)) {
      providers.push(candidate);
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
/** Reads a boolean field off the untrusted body, using the supplied compatibility fallback when it's
 *  absent or not a boolean — covers an older server that predates these fields as well as a
 *  malformed response. See `AuthContextValue.canCreateAccount` (authContext.ts) for why "unknown"
 *  means "allowed": the server 403 is the authoritative enforcer, this only gates a UI affordance. */
export function resolveBooleanField(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
