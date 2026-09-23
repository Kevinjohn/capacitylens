import { randomBytes } from "node:crypto";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import type { BoundApplication } from "@capacitylens/shared/account/types";
import { boundApplicationFailure } from "@capacitylens/shared/account/validation";
import type { Db } from "../db";
import type * as AuthFacade from "../auth";
import { resolveAccountEnvironment } from "../accountConfig";
import { buildProviders, companyProviderIds, prepareProviders } from "./providers";
import { buildPasswordPolicy } from "./passwordPolicy";
import { buildDatabaseHooks } from "./databaseHooks";
import { buildRequestHooks } from "./requestHooks";
import { buildSessionPolicy } from "./sessionPolicy";
import { buildPlugins } from "./plugins";
import { DEFAULT_ACCOUNT_APPLICATION, type Auth, type AccountMode } from "./authTypes";
import {
  MIN_BETTER_AUTH_SECRET_LENGTH,
  RESET_LINK_TTL_SECONDS,
  SESSION_ABSOLUTE_TTL_SECONDS,
  SESSION_FRESH_AGE_SECONDS,
} from "./authConstants";
import {
  authHandlerErrorCapture,
  passwordResetSessionCapture,
  captureResetToken,
  microsoftCallbackCapture,
} from "./captureContexts";
import { hashPasswordWithBackpressure, verifyPasswordWithBackpressure } from "./passwordBackpressure";
import { enforceSessionActivity, createTwoFactorEnabledLookupStatement } from "./sessionActivity";
import type { createAuthAdapterFactory } from "./authAdapter";
import type { MicrosoftProof } from "./microsoftProof";
import { createConfiguredMicrosoftProof } from "./microsoftProofSetup";
import { parsePublicUrl } from "./publicUrlConfig";

type Env = Record<string, string | undefined>;
type AuthFromEnvOptions = {
  trustedOrigins?: string[];
  deferDatabaseSetup?: boolean;
  application?: BoundApplication;
  /** Account-boundary admission decision for a prospective external local principal. Omission
   * fails closed; ordinary sign-in for an already-linked principal does not use this hook. */
  externalIdentityAdmission?: (candidate: {
    email?: string;
    emailVerified?: boolean;
    providerId: string | null;
  }) => boolean | Promise<boolean>;
};
type FactoryDependencies = {
  AuthConfigError: typeof AuthFacade.AuthConfigError;
  parseAuthMode: typeof AuthFacade.parseAuthMode;
  required: (environment: Env, key: string, context: string) => string;
  assertStrictOidcEmailAdmission: typeof AuthFacade.assertStrictOidcEmailAdmission;
  isSqliteConstraintCollision: (sqlite: { code?: unknown; errcode?: unknown }) => boolean;
  providerIdFromExternalContext: typeof AuthFacade.parseProviderIdFromExternalContext;
  countUsers: typeof AuthFacade.countUsers;
  externalIdentityPath: (path: string | undefined) => boolean;
  secretTokenMatches: typeof AuthFacade.isMatchingSecretToken;
  ensureAuthControlTables: typeof AuthFacade.ensureAuthControlTables;
  createAuthAdapter: ReturnType<typeof createAuthAdapterFactory>;
};
type SessionDeletionLifecycleRef = {
  current: {
    prepareSession(sessionToken: string, reason: "session_expired"): readonly string[];
    prepareUser(userId: string, reason: "session_revoked"): readonly string[];
    commit(sessionHandles: readonly string[]): void;
  } | null;
};
type EnabledAuthContext = {
  db: Db;
  environment: Env;
  runtimeEnvironment: string | undefined;
  mode: Exclude<AccountMode, "off">;
  options: AuthFromEnvOptions;
  dependencies: FactoryDependencies;
  application: BoundApplication;
  secret: string;
  baseURL: string;
  publicUrl: URL;
  sessionDeletionLifecycleRef: SessionDeletionLifecycleRef;
};

function requireApplication(
  application: BoundApplication,
  AuthConfigError: FactoryDependencies["AuthConfigError"],
): void {
  const applicationFailure = boundApplicationFailure(application);
  if (applicationFailure) throw new AuthConfigError(applicationFailure);
}

function requireSecret(environment: Env, mode: AccountMode, dependencies: FactoryDependencies): string {
  const secret = dependencies.required(environment, "SMALLSASS_ACCOUNT_SECRET", `SMALLSASS_ACCOUNT_MODE=${mode}`);
  if (secret.length < MIN_BETTER_AUTH_SECRET_LENGTH) {
    throw new dependencies.AuthConfigError(
      `SMALLSASS_ACCOUNT_SECRET must be at least ${MIN_BETTER_AUTH_SECRET_LENGTH} characters when SMALLSASS_ACCOUNT_MODE=${mode} (got ${secret.length}).`,
    );
  }
  return secret;
}

function isSqliteError(error: unknown): error is { code?: unknown; errcode?: unknown; message?: unknown } {
  return typeof error === "object" && error !== null;
}

function createBootstrapClaim(db: Db, dependencies: FactoryDependencies): () => string {
  return () => {
    const claimToken = randomBytes(24).toString("base64url");
    try {
      db.prepare(`INSERT INTO capacitylens_bootstrap_claim (id, claimedAt, claimToken) VALUES (1, ?, ?)`).run(
        new Date().toISOString(),
        claimToken,
      );
      const microsoftCallback = microsoftCallbackCapture.getStore();
      if (microsoftCallback) microsoftCallback.bootstrapClaimToken = claimToken;
      return claimToken;
    } catch (error) {
      if (!isSqliteError(error)) throw error;
      const collision =
        dependencies.isSqliteConstraintCollision(error) ||
        (typeof error.message === "string" && /constraint failed.*capacitylens_bootstrap_claim/i.test(error.message));
      if (!collision) throw error;
      throw APIError.from("CONFLICT", {
        message: "First-owner setup is already in progress.",
        code: "BOOTSTRAP_ALREADY_IN_PROGRESS",
      });
    }
  };
}

function requireSetupToken(
  environment: Env,
  mode: AccountMode,
  AuthConfigError: FactoryDependencies["AuthConfigError"],
) {
  const configuredSetupToken = environment.SMALLSASS_ACCOUNT_SETUP_TOKEN;
  const setupToken = configuredSetupToken === "" ? undefined : configuredSetupToken;
  if (mode === "password" && setupToken && Buffer.byteLength(setupToken, "utf8") < 32) {
    throw new AuthConfigError("SMALLSASS_ACCOUNT_SETUP_TOKEN must be at least 32 bytes.");
  }
  return setupToken;
}

function createEnabledAuthContext(input: {
  db: Db;
  environment: Env;
  runtimeEnvironment: string | undefined;
  mode: Exclude<AccountMode, "off">;
  options: AuthFromEnvOptions;
  dependencies: FactoryDependencies;
}): EnabledAuthContext {
  const application = input.options.application ?? DEFAULT_ACCOUNT_APPLICATION;
  requireApplication(application, input.dependencies.AuthConfigError);
  const secret = requireSecret(input.environment, input.mode, input.dependencies);
  const baseURL = input.dependencies.required(
    input.environment,
    "SMALLSASS_ACCOUNT_PUBLIC_URL",
    `SMALLSASS_ACCOUNT_MODE=${input.mode}`,
  );
  const publicUrl = parsePublicUrl(baseURL, input.runtimeEnvironment, input.dependencies.AuthConfigError);
  return {
    ...input,
    application,
    secret,
    baseURL,
    publicUrl,
    sessionDeletionLifecycleRef: { current: null },
  };
}

// Retain one facade-owned error class and policy surface without a runtime cycle.
export function createAuthFromEnvironmentFactory(dependencies: FactoryDependencies) {
  /** Build the Better Auth instance for the parsed mode — or null in 'off' mode, where no
   *  env beyond SMALLSASS_ACCOUNT_MODE itself is read. `trustedOrigins` should be the same browser
   *  origins the CORS allow-list names (Better Auth checks Origin on state-changing calls);
   *  the same-origin production deploy needs none.
   *
   *  Cookie security is derived from `SMALLSASS_ACCOUNT_PUBLIC_URL`, the browser-facing public origin. It must
   *  never be tied to whether the Node hop itself terminates TLS: the normal nginx deployment uses
   *  HTTPS in the browser and HTTP between nginx and Node. */
  return function authFromEnv(
    db: Db,
    environment: Env,
    options: AuthFromEnvOptions = {},
  ): { mode: AccountMode; auth: Auth | null } {
    const runtimeEnvironment = environment.NODE_ENV ?? process.env.NODE_ENV;
    const resolvedEnvironment = resolveAccountEnvironment(environment).env;
    const mode = dependencies.parseAuthMode(resolvedEnvironment.SMALLSASS_ACCOUNT_MODE);
    if (mode === "off") return { mode, auth: null };
    const context = createEnabledAuthContext({
      db,
      environment: resolvedEnvironment,
      runtimeEnvironment,
      mode,
      options,
      dependencies,
    });
    return buildEnabledAuth(context);
  };
}

function buildProviderPolicies(context: EnabledAuthContext, microsoftProof: MicrosoftProof | null) {
  const { db, environment, mode, publicUrl, application, options, dependencies } = context;
  const preparedProviderConfig = prepareProviders({
    db,
    env: environment,
    mode,
    publicUrl,
    authHandlerErrorCapture,
    AuthConfigError: dependencies.AuthConfigError,
    required: dependencies.required,
    assertStrictOidcEmailAdmission: dependencies.assertStrictOidcEmailAdmission,
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
  // (a hole). SMALLSASS_ACCOUNT_ALLOW_OPEN_SIGNUP=1 keeps its meaning — an INTERIM trusted-instance/dev
  // escape that re-opens signup unconditionally. With neither condition, POST
  // /api/auth/sign-up/email returns the same 400 EMAIL_PASSWORD_SIGN_UP_DISABLED as before.
  const allowOpenSignup = environment.SMALLSASS_ACCOUNT_ALLOW_OPEN_SIGNUP === "1";
  const setupToken = requireSetupToken(environment, mode, dependencies.AuthConfigError);
  const providerConfig = buildProviders({
    env: environment,
    defaultProviderLabel: application.branding.defaultProviderLabel,
    trustedOrigins: options.trustedOrigins,
    prepared: preparedProviderConfig,
    AuthConfigError: dependencies.AuthConfigError,
    db,
    microsoftProof,
  });
  return { pluginOptions, allowOpenSignup, setupToken, providerConfig };
}

function browserAuthErrorTarget(publicUrl: URL): URL {
  const target = new URL("/", publicUrl);
  target.searchParams.set("externalSignInError", "1");
  return target;
}

function buildAuthPolicies(context: EnabledAuthContext, providers: ReturnType<typeof buildProviderPolicies>) {
  const { db, environment, runtimeEnvironment, mode, application, secret, baseURL, publicUrl, options, dependencies } =
    context;
  const passwordPolicy = buildPasswordPolicy({
    env: environment,
    mode,
    runtimeEnvironment,
    passwordContextWords: application.branding.passwordContextWords,
    passwordResetSessionCapture,
    sessionDeletionLifecycleRef: context.sessionDeletionLifecycleRef,
    captureResetToken,
    hashPasswordWithBackpressure,
    verifyPasswordWithBackpressure,
    resetLinkTtlSeconds: RESET_LINK_TTL_SECONDS,
  });
  const cookiePrefix =
    publicUrl.protocol === "https:" ? `__Host-${application.applicationId}` : application.applicationId;
  const browserAuthErrorUrl = browserAuthErrorTarget(publicUrl);

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
    genericProviderId: providers.providerConfig.genericProviderId,
    configuredFederatedIssuers: providers.providerConfig.configuredFederatedIssuers,
    permittedCompanyProviderIds: companyProviderIds(providers.providerConfig.configuredProviderInfo),
    allowOpenSignup: providers.allowOpenSignup,
    requirePasswordMfa: mode === "password" && environment.SMALLSASS_ACCOUNT_REQUIRE_MFA === "1",
    ...(options.externalIdentityAdmission === undefined
      ? {}
      : { externalIdentityAdmission: options.externalIdentityAdmission }),
    providerIdFromExternalContext: dependencies.providerIdFromExternalContext,
    countUsers: dependencies.countUsers,
    twoFactorEnabledLookupStatement: createTwoFactorEnabledLookupStatement,
    externalIdentityPath: dependencies.externalIdentityPath,
  });
  const requestHookOptions = buildRequestHooks({
    db,
    browserAuthErrorUrl,
    authHandlerErrorCapture,
    allowOpenSignup: providers.allowOpenSignup,
    setupToken: providers.setupToken,
    sessionDeletionLifecycleRef: context.sessionDeletionLifecycleRef,
    acquireBootstrapClaim: createBootstrapClaim(db, dependencies),
    assertAuthRequestPasswordLength: passwordPolicy.assertAuthRequestPasswordLength,
    countUsers: dependencies.countUsers,
    enforceSessionActivity,
    secretTokenMatches: dependencies.secretTokenMatches,
    externalIdentityPath: dependencies.externalIdentityPath,
  });
  return { passwordPolicy, sessionPolicy, databaseHookOptions, requestHookOptions, browserAuthErrorUrl };
}

function createBetterAuthInstance(
  providers: ReturnType<typeof buildProviderPolicies>,
  policies: ReturnType<typeof buildAuthPolicies>,
  db: Db,
): unknown {
  const { providerConfig, pluginOptions } = providers;
  const { passwordPolicy, sessionPolicy, databaseHookOptions, requestHookOptions } = policies;
  const instance: unknown = betterAuth({
    database: db,
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
    socialProviders: providerConfig.configuredSocialProviders,
    hooks: requestHookOptions.hooks,
    plugins: pluginOptions.plugins,
    trustedOrigins: providerConfig.trustedOrigins,
    advanced: sessionPolicy.advanced,
    session: sessionPolicy.session,
    telemetry: sessionPolicy.telemetry,
  });
  return instance;
}

function buildEnabledAuth(context: EnabledAuthContext): { mode: AccountMode; auth: Auth } {
  let activeAuth: Auth | null = null;
  const microsoftProof = createConfiguredMicrosoftProof({
    db: context.db,
    environment: context.environment,
    secret: context.secret,
    publicUrl: context.publicUrl,
    applicationId: context.application.applicationId,
    trustedOrigins: context.options.trustedOrigins ?? [],
    AuthConfigError: context.dependencies.AuthConfigError,
    getAuth: () => activeAuth,
  });
  const providers = buildProviderPolicies(context, microsoftProof);
  const policies = buildAuthPolicies(context, providers);
  const instance = createBetterAuthInstance(providers, policies, context.db);
  // betterAuth construction validates its resolved options but does not own this app-specific
  // table. Verify and expire its leases only after configuration and app migrations have succeeded.
  if (!context.options.deferDatabaseSetup) {
    context.dependencies.ensureAuthControlTables(context.db, context.environment);
  }
  const auth = context.dependencies.createAuthAdapter({
    db: context.db,
    application: context.application,
    instance,
    configuredProviderInfo: providers.providerConfig.configuredProviderInfo,
    configuredFederatedIssuers: providers.providerConfig.configuredFederatedIssuers,
    publicUrl: context.publicUrl,
    browserAuthErrorUrl: policies.browserAuthErrorUrl,
    trustedOrigins: providers.providerConfig.trustedOrigins,
    strictOidcClient: providers.providerConfig.strictOidcClient,
    strictOidcAuthorizationProxyPath: providers.providerConfig.strictOidcAuthorizationProxyPath,
    sessionDeletionLifecycleRef: context.sessionDeletionLifecycleRef,
    microsoftProof,
  });
  activeAuth = auth;
  if (!context.options.deferDatabaseSetup) auth.ensureProviderBindings();
  return { mode: context.mode, auth };
}
