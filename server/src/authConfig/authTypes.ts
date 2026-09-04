import type { BetterAuthOptions } from "better-auth";
import type { AccountMode, BoundApplication } from "@capacitylens/shared/account/types";
import { APP_NAME } from "@capacitylens/shared/brand";
import { PASSWORD_CONTEXT_WORDS } from "../passwordSecurity";

/** @deprecated Prefer the provider-neutral AccountMode outside the identity adapter. */
export type AuthMode = AccountMode;

/** Public, non-secret provider metadata exposed by `/api/auth/me` so the login screen never
 * hardcodes a provider id or advertises a provider the server did not configure. Every external
 * named social providers remain experimental; the strict generic OIDC path is first-class. */
export interface AuthProviderInfo {
  id: string;
  label: string;
  kind: "social" | "oidc";
  experimental: boolean;
}

/** The narrow Better Auth surface the server actually uses. betterAuth()'s concrete
 *  return type is invariant in its options generic (a plugin-parametrised instantiation
 *  won't assign to Auth<BetterAuthOptions>), so authFromEnv collapses it to this
 *  structural interface once at creation — everything downstream stays decoupled from
 *  the library's generics. */
export interface Auth {
  /** Web-standard Request → Response handler, mounted at /api/auth/* when mode ≠ off. */
  handler: (request: Request) => Promise<Response>;
  api: {
    getSession: (input: { headers: Headers }) => Promise<{
      user: SessionUser;
      session?: {
        id: string;
        createdAt: string;
        expiresAt: string | null;
      };
    } | null>;
    /** Better Auth's server-side reset-token mint (P1.18) — call it ONLY through
     *  {@link mintPasswordResetToken}, which provides the AsyncLocalStorage capture context the
     *  sendResetPassword callback delivers the token into. Anti-enumeration by design: it resolves
     *  with a generic success whether or not the email matched a user. */
    requestPasswordReset: (input: { body: { email: string } }) => Promise<unknown>;
  };
  /** Resolved options — what getMigrations needs to create the auth tables. */
  options: BetterAuthOptions;
  /** Configured external identity providers, safe to return to unauthenticated clients. */
  providers: AuthProviderInfo[];
  /** Configured upstream issuer for each local provider alias. Used for `(issuer, subject)` keys. */
  federatedIssuers: ReadonlyMap<string, string>;
  /** The one strict OIDC provider used by the supported SSO cutover ceremony. */
  strictProvider?: AuthProviderInfo | null;
  /** Validate and persist immutable issuer-to-provider aliases after app migrations complete. */
  ensureProviderBindings: () => void;
  /** Verify every configured issuer/provider alias without writing (operator preflight). */
  assertProviderBindings?: () => void;
  /** Create a user + credential account as one SQLite transaction, bypassing the
   *  public sign-up ROUTE entirely (and with it, the route's minPasswordLength check —
   *  internalAdapter.createUser never validates password shape, only the sign-up.mjs handler
   *  does). This is why the instance-wide minPasswordLength floor no longer needs to be bent for
   *  the bootstrap boot (see the comment on minPasswordLength below authFromEnv).
   *
   *  Deliberately the ONLY way to reach Better Auth's internalAdapter from outside this module —
   *  earlier this exposed hashPassword/createUser/linkAccount as three independently callable
   *  methods, an interface shape that invited a future caller to create a user with no credential
   *  (an orphaned row that permanently locks out the bootstrap: {@link countUsers} > 0 forever,
   *  with no sign-in-able account). This method owns hash → user → credential-link sequencing
   *  and the transaction boundary, so that hazard can't recur. An optional local correlation
   *  callback joins another same-database write (the invitation command's principal coordinate)
   *  to that transaction. Resolves once Better Auth's async init context ($context) is ready;
   *  nothing else should call it — every other caller goes through the narrow api surface above.
   *
   *  @throws when hashing or any transaction participant fails; SQLite rolls every credential and
   *  correlation write back before the failure escapes.
   */
  createCredentialUser: (
    email: string,
    name: string,
    password: string,
    emailVerified?: boolean,
    correlateInTransaction?: (principalId: string) => void,
  ) => Promise<{ id: string }>;
  /** Remove a just-created credential identity when a later invite claim cannot commit. */
  deleteCredentialUser: (userId: string) => Promise<void>;
  /** Revoke every active session for a user (administrator offboarding/compromise response). */
  revokeUserSessions: (userId: string) => Promise<void>;
  /** Late-bound application observer for session deletions owned by Better Auth. */
  setSessionDeletionLifecycle?(
    lifecycle: {
      prepareSession(sessionToken: string, reason: "session_expired"): readonly string[];
      prepareUser(userId: string, reason: "session_revoked"): readonly string[];
      commit(sessionHandles: readonly string[]): void;
    } | null,
  ): void;
  /** Start the only supported explicit identity-link ceremony. The raw provider route remains
   * shadowed at the HTTP adapter, so freshness and provider policy cannot be bypassed. */
  beginFederatedLink?: (input: {
    headers: Headers;
    principalId: string;
    callbackURL: string;
    errorCallbackURL: string;
  }) => Promise<{ url: string; setCookies: string[] }>;
  /** Finish any callback that committed before its audit/observation transaction completed. */
  reconcileFederatedLinks?: () => void;
}

/** The identity attached to every request in 'off' mode — the seam Stage C will later
 *  replace with the session user to derive accountId server-side. Off is trusted-local, so
 *  the synthetic principal is treated as verified (`emailVerified: true`) and given a clearly
 *  non-routable `.local` demo email so nothing mistakes it for a real verified identity. */
export const DEMO_USER: SessionUser = {
  id: "demo",
  name: "Demo",
  email: "demo@capacitylens.local",
  emailVerified: true,
  twoFactorEnabled: true,
  image: null,
};

export const DEFAULT_ACCOUNT_APPLICATION: BoundApplication = {
  applicationId: "capacitylens",
  displayName: APP_NAME,
  branding: {
    totpIssuer: APP_NAME,
    passwordContextWords: PASSWORD_CONTEXT_WORDS,
    defaultProviderLabel: "Single sign-on",
  },
};

/**
 * The normalized session principal the whole server depends on (membership lookups,
 * `/api/auth/me`, P1.10 invite binding) — decoupled from Better Auth's richer user type.
 *
 * `emailVerified` is the IdP-asserted verified-email flag. It defaults to `false` when a
 * provider omits it (see {@link normalizeSessionUser}): an unverifiable provider is treated as
 * unverified. SSO email-preauthorised invites bind a session only when `emailVerified === true`;
 * password deployments instead treat possession of the addressed invite as the verification
 * ceremony because they have no outbound email-verification service. Never widen the SSO check to
 * "truthy" or default this flag to `true`.
 */
export interface SessionUser {
  id: string;
  email: string;
  emailVerified: boolean;
  twoFactorEnabled?: boolean;
  name: string;
  /** The IdP-asserted avatar URL (OIDC `picture` claim) mapped into Better Auth's `user.image`
   *  column. Already https-validated at capture time by strictOidc's `optionalPictureUrl`; `null`
   *  for accounts/providers that carry no picture. */
  image: string | null;
  /** Server-only freshness input for step-up checks; never used as an authenticator. */
  sessionCreatedAt?: string;
}

/** The subset of Better Auth's user we read before narrowing to {@link SessionUser}. Better
 *  Auth types `emailVerified` as a boolean it sets per provider; the optional/`null` here is
 *  the safety net for a provider/version that leaves it unset. */
export interface RawSessionUser {
  id: string;
  email: string;
  name: string;
  emailVerified?: boolean | null;
  twoFactorEnabled?: boolean | null;
  image?: string | null;
}
