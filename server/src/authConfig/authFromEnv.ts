import { randomBytes } from "node:crypto";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import type { BoundApplication } from "@capacitylens/shared/account/types";
import { boundApplicationFailure } from "@capacitylens/shared/account/validation";
import type { Db } from "../db";
import type * as AuthFacade from "../auth";
import { resolveAccountEnvironment } from "../accountConfig";
import { isLoopbackHostname } from "../strictOidc";
import { buildProviders, prepareProviders } from "./providers";
import { buildPasswordPolicy } from "./passwordPolicy";
import { buildDatabaseHooks } from "./databaseHooks";
import { buildRequestHooks } from "./requestHooks";
import { buildSessionPolicy } from "./sessionPolicy";
import { buildPlugins } from "./plugins";
import { DEFAULT_ACCOUNT_APPLICATION, type Auth, type AuthMode } from "./authTypes";
import {
  MIN_BETTER_AUTH_SECRET_LENGTH,
  RESET_LINK_TTL_SECONDS,
  SESSION_ABSOLUTE_TTL_SECONDS,
  SESSION_FRESH_AGE_SECONDS,
} from "./authConstants";
import { authHandlerErrorCapture, passwordResetSessionCapture, captureResetToken } from "./captureContexts";
import { hashPasswordWithBackpressure, verifyPasswordWithBackpressure } from "./passwordBackpressure";
import { enforceSessionActivity, twoFactorEnabledLookupStatement } from "./sessionActivity";
import type { buildAuthAdapter } from "./authAdapter";

type Env = Record<string, string | undefined>;

// Retain one facade-owned error class and policy surface without a runtime cycle.
export function buildAuthFromEnv({
  AuthConfigError,
  parseAuthMode,
  required,
  assertStrictOidcEmailAdmission,
  isSqliteConstraintCollision,
  providerIdFromExternalContext,
  countUsers,
  externalIdentityPath,
  secretTokenMatches,
  ensureAuthControlTables,
  createAuthAdapter,
}: {
  AuthConfigError: typeof AuthFacade.AuthConfigError;
  parseAuthMode: typeof AuthFacade.parseAuthMode;
  required: (env: Env, key: string, context: string) => string;
  assertStrictOidcEmailAdmission: typeof AuthFacade.assertStrictOidcEmailAdmission;
  isSqliteConstraintCollision: (sqlite: { code?: unknown; errcode?: unknown }) => boolean;
  providerIdFromExternalContext: typeof AuthFacade.providerIdFromExternalContext;
  countUsers: typeof AuthFacade.countUsers;
  externalIdentityPath: (path: string | undefined) => boolean;
  secretTokenMatches: typeof AuthFacade.secretTokenMatches;
  ensureAuthControlTables: typeof AuthFacade.ensureAuthControlTables;
  createAuthAdapter: ReturnType<typeof buildAuthAdapter>;
}) {
  /** Build the Better Auth instance for the parsed mode — or null in 'off' mode, where no
   *  env beyond CAPACITYLENS_AUTH itself is read. `trustedOrigins` should be the same browser
   *  origins the CORS allow-list names (Better Auth checks Origin on state-changing calls);
   *  the same-origin production deploy needs none.
   *
   *  Cookie security is derived from `BETTER_AUTH_URL`, the browser-facing public origin. It must
   *  never be tied to whether the Node hop itself terminates TLS: the normal nginx deployment uses
   *  HTTPS in the browser and HTTP between nginx and Node. */
  function authFromEnv(
    db: Db,
    env: Env,
    opts: {
      trustedOrigins?: string[];
      deferDatabaseSetup?: boolean;
      application?: BoundApplication;
      /** Account-boundary admission decision for a prospective external local principal. Omission
       * fails closed; ordinary sign-in for an already-linked principal does not use this hook. */
      externalIdentityAdmission?: (candidate: {
        email?: string;
        emailVerified?: boolean;
      }) => boolean | Promise<boolean>;
    } = {},
  ): { mode: AuthMode; auth: Auth | null } {
    const runtimeEnvironment = env.NODE_ENV ?? process.env.NODE_ENV;
    env = resolveAccountEnvironment(env, {
      ...(runtimeEnvironment === "test" ? { warn: () => {} } : {}),
    }).env;
    const mode = parseAuthMode(env.CAPACITYLENS_AUTH);
    if (mode === "off") return { mode, auth: null };
    const requirePasswordMfa = mode === "password" && env.CAPACITYLENS_REQUIRE_MFA === "1";
    const application = opts.application ?? DEFAULT_ACCOUNT_APPLICATION;
    const applicationFailure = boundApplicationFailure(application);
    if (applicationFailure) throw new AuthConfigError(applicationFailure);

    const secret = required(env, "BETTER_AUTH_SECRET", `SMALLSASS_ACCOUNT_MODE=${mode}`);
    // Fail closed + loud on a weak secret (message states the requirement + actual length,
    // never the secret value itself — no leak into logs/exit output).
    if (secret.length < MIN_BETTER_AUTH_SECRET_LENGTH) {
      throw new AuthConfigError(
        `SMALLSASS_ACCOUNT_SECRET must be at least ${MIN_BETTER_AUTH_SECRET_LENGTH} characters when SMALLSASS_ACCOUNT_MODE=${mode} (got ${secret.length}).`,
      );
    }
    const baseURL = required(env, "BETTER_AUTH_URL", `SMALLSASS_ACCOUNT_MODE=${mode}`);

    let publicUrl: URL;
    try {
      publicUrl = new URL(baseURL);
    } catch (cause) {
      throw new AuthConfigError("SMALLSASS_ACCOUNT_PUBLIC_URL must be an absolute http:// or https:// URL.", { cause });
    }
    if (publicUrl.protocol !== "http:" && publicUrl.protocol !== "https:") {
      throw new AuthConfigError("SMALLSASS_ACCOUNT_PUBLIC_URL must use http:// or https://.");
    }
    if (publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash) {
      throw new AuthConfigError(
        "SMALLSASS_ACCOUNT_PUBLIC_URL must be an origin without credentials, a query string, or a fragment.",
      );
    }
    if (publicUrl.pathname !== "/" && publicUrl.pathname !== "") {
      throw new AuthConfigError("SMALLSASS_ACCOUNT_PUBLIC_URL must be an origin without a path.");
    }
    const loopbackHost = isLoopbackHostname(publicUrl.hostname);
    if (runtimeEnvironment === "production" && publicUrl.protocol !== "https:" && !loopbackHost) {
      throw new AuthConfigError(
        "SMALLSASS_ACCOUNT_PUBLIC_URL must use https:// for a non-loopback production origin; credentials and session cookies must not cross plaintext HTTP.",
      );
    }

    const sessionDeletionLifecycleRef: {
      current: {
        prepareSession(sessionToken: string, reason: "session_expired"): readonly string[];
        prepareUser(userId: string, reason: "session_revoked"): readonly string[];
        commit(sessionHandles: readonly string[]): void;
      } | null;
    } = { current: null };

    const preparedProviderConfig = prepareProviders({
      db,
      env,
      mode,
      publicUrl,
      authHandlerErrorCapture,
      AuthConfigError,
      required,
      assertStrictOidcEmailAdmission,
    });
    const pluginOptions = buildPlugins({
      mode,
      genericOidcPlugin: preparedProviderConfig.genericOidcPlugin,
      totpIssuer: application.branding.totpIssuer,
    });
    // SECURE DEFAULT (P1.7) + FIRST-RUN SETUP: self-service signup is closed / invite-only by
    // design (Decisions — social SSO is the primary path; email+password a secondary fallback),
    // with EXACTLY ONE bootstrap exception: an EMPTY user table plus the operator-configured setup
    // token. The first sign-up creates the owner; the token prevents an arbitrary network visitor
    // from claiming that seat. The gate is enforced LIVE, per request, by the hooks.before below —
    // NOT by Better Auth's static
    // disableSignUp, because a boot-time boolean cannot express "open while zero users, closed the
    // moment the first user exists": a still-running server would keep signup open until a restart
    // (a hole). CAPACITYLENS_ALLOW_OPEN_SIGNUP=1 keeps its meaning — an INTERIM trusted-instance/dev
    // escape that re-opens signup unconditionally. With neither condition, POST
    // /api/auth/sign-up/email returns the same 400 EMAIL_PASSWORD_SIGN_UP_DISABLED as before.
    const allowOpenSignup = env.CAPACITYLENS_ALLOW_OPEN_SIGNUP === "1";
    const setupToken = env.CAPACITYLENS_SETUP_TOKEN || undefined;
    if (mode === "password" && setupToken && Buffer.byteLength(setupToken, "utf8") < 32) {
      throw new AuthConfigError("SMALLSASS_ACCOUNT_SETUP_TOKEN must be at least 32 bytes.");
    }
    const providerConfig = buildProviders({
      env,
      defaultProviderLabel: application.branding.defaultProviderLabel,
      trustedOrigins: opts.trustedOrigins,
      prepared: preparedProviderConfig,
      AuthConfigError,
    });
    const {
      genericProviderId,
      strictOidcClient,
      strictOidcAuthorizationProxyPath,
      configuredSocialProviders,
      configuredProviderInfo,
      configuredFederatedIssuers,
    } = providerConfig;
    const acquireBootstrapClaim = (): string => {
      const claimToken = randomBytes(24).toString("base64url");
      try {
        db.prepare(`INSERT INTO capacitylens_bootstrap_claim (id, claimedAt, claimToken) VALUES (1, ?, ?)`).run(
          new Date().toISOString(),
          claimToken,
        );
        return claimToken;
      } catch (error) {
        const sqlite = error as {
          code?: unknown;
          errcode?: unknown;
          message?: unknown;
        };
        const collision =
          isSqliteConstraintCollision(sqlite) ||
          (typeof sqlite.message === "string" &&
            /constraint failed.*capacitylens_bootstrap_claim/i.test(sqlite.message));
        if (!collision) throw error;
        throw APIError.from("CONFLICT", {
          message: "First-owner setup is already in progress.",
          code: "BOOTSTRAP_ALREADY_IN_PROGRESS",
        });
      }
    };

    const passwordPolicy = buildPasswordPolicy({
      env,
      mode,
      runtimeEnvironment,
      passwordContextWords: application.branding.passwordContextWords,
      passwordResetSessionCapture,
      sessionDeletionLifecycleRef,
      captureResetToken,
      hashPasswordWithBackpressure,
      verifyPasswordWithBackpressure,
      resetLinkTtlSeconds: RESET_LINK_TTL_SECONDS,
    });
    const cookiePrefix =
      publicUrl.protocol === "https:" ? `__Host-${application.applicationId}` : application.applicationId;
    const browserAuthErrorUrl = new URL("/", publicUrl);
    browserAuthErrorUrl.searchParams.set("externalSignInError", "1");

    const sessionPolicy = buildSessionPolicy({
      db,
      secret,
      baseURL,
      cookiePrefix,
      secureCookies: publicUrl.protocol === "https:",
      sessionAbsoluteTtlSeconds: SESSION_ABSOLUTE_TTL_SECONDS,
      sessionFreshAgeSeconds: SESSION_FRESH_AGE_SECONDS,
    });
    const databaseHookOptions = buildDatabaseHooks({
      db,
      mode,
      application,
      genericProviderId,
      configuredFederatedIssuers,
      allowOpenSignup,
      requirePasswordMfa,
      externalIdentityAdmission: opts.externalIdentityAdmission,
      providerIdFromExternalContext,
      countUsers,
      twoFactorEnabledLookupStatement,
      externalIdentityPath,
    });
    const requestHookOptions = buildRequestHooks({
      db,
      browserAuthErrorUrl,
      authHandlerErrorCapture,
      allowOpenSignup,
      setupToken,
      sessionDeletionLifecycleRef,
      acquireBootstrapClaim,
      assertAuthRequestPasswordLength: passwordPolicy.assertAuthRequestPasswordLength,
      countUsers,
      enforceSessionActivity,
      secretTokenMatches,
      externalIdentityPath,
    });

    const instance = betterAuth({
      database: sessionPolicy.database,
      secret: sessionPolicy.secret,
      baseURL: sessionPolicy.baseURL,
      basePath: sessionPolicy.basePath,
      onAPIError: requestHookOptions.onAPIError,
      verification: sessionPolicy.verification,
      databaseHooks: databaseHookOptions.databaseHooks,
      account: sessionPolicy.account,
      emailAndPassword: passwordPolicy.emailAndPassword,
      // Native Google/Microsoft/GitHub sign-in, each only when its env is set (see helper).
      // Independent of the 'sso' genericOAuth plugin above; an empty object = none configured.
      socialProviders: configuredSocialProviders,
      hooks: requestHookOptions.hooks,
      plugins: pluginOptions.plugins,
      trustedOrigins: providerConfig.trustedOrigins,
      advanced: sessionPolicy.advanced,
      session: sessionPolicy.session,
      telemetry: sessionPolicy.telemetry,
    });
    // betterAuth construction validates its resolved options but does not own this app-specific
    // table. Verify and expire its leases only after configuration and app migrations have succeeded.
    if (!opts.deferDatabaseSetup) ensureAuthControlTables(db, env);
    const auth = createAuthAdapter({
      db,
      application,
      instance,
      configuredProviderInfo,
      configuredFederatedIssuers,
      publicUrl,
      browserAuthErrorUrl,
      trustedOrigins: providerConfig.trustedOrigins,
      strictOidcClient,
      strictOidcAuthorizationProxyPath,
      sessionDeletionLifecycleRef,
    });
    if (!opts.deferDatabaseSetup) auth.ensureProviderBindings();
    return { mode, auth };
  }

  return authFromEnv;
}
