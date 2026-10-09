import { createMailSender } from "./mailSender";
import type { MailSender } from "./mailSender";
import { allowsPasswordSignIn } from "@capacitylens/shared/account/types";
import { randomBytes } from "node:crypto";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { allowsProviderSignIn } from "@capacitylens/shared/account/types";
import type { BoundApplication } from "@capacitylens/shared/account/types";
import { boundApplicationFailure } from "@capacitylens/shared/account/validation";
import type { Db } from "../db";
import { gateLibraryTransactions } from "./gateLibraryTransactions";
import type * as AuthFacade from "../auth";
import { resolveAccountEnvironment } from "../accountConfig";
import { buildProviders, companyProviderIds } from "./providers";
import { buildPasswordPolicy } from "./passwordPolicy";
import { buildDatabaseHooks } from "./databaseHooks";
import { buildRequestHooks } from "./requestHooks";
import { buildSessionPolicy } from "./sessionPolicy";
import { buildPlugins } from "./plugins";
import { DEFAULT_ACCOUNT_APPLICATION } from "./authTypes";
import type { Auth, AccountMode } from "./authTypes";
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
import { currentJoiningProviderFacts } from "../accounts/adminPort/joiningProviderCallbacks";
import type { createJoiningProviderCallbacks } from "../accounts/adminPort/joiningProviderCallbacks";

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
  joiningProviderCallbacks?: Pick<ReturnType<typeof createJoiningProviderCallbacks>, "preflight" | "bindSession">;
};
type FactoryDependencies = {
  AuthConfigError: typeof AuthFacade.AuthConfigError;
  parseAuthMode: typeof AuthFacade.parseAuthMode;
  required: (environment: Env, key: string, context: string) => string;
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
  mail: MailSender | null;
};

function assertApplication(
  application: BoundApplication,
  AuthConfigError: FactoryDependencies["AuthConfigError"],
): void {
  const applicationFailure = boundApplicationFailure(application);
  if (applicationFailure) throw new AuthConfigError(applicationFailure);
}

function requireSecret(environment: Env, mode: AccountMode, dependencies: FactoryDependencies): string {
  const secret = dependencies.required(environment, "CAPACITYLENS_SECRET", `CAPACITYLENS_MODE=${mode}`);
  if (secret.length < MIN_BETTER_AUTH_SECRET_LENGTH) {
    throw new dependencies.AuthConfigError(
      `CAPACITYLENS_SECRET must be at least ${MIN_BETTER_AUTH_SECRET_LENGTH} characters when CAPACITYLENS_MODE=${mode} (got ${secret.length}).`,
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
  const configuredSetupToken = environment.CAPACITYLENS_SETUP_TOKEN;
  const setupToken = configuredSetupToken === "" ? undefined : configuredSetupToken;
  if (allowsPasswordSignIn(mode) && setupToken && Buffer.byteLength(setupToken, "utf8") < 32) {
    throw new AuthConfigError("CAPACITYLENS_SETUP_TOKEN must be at least 32 bytes.");
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
  assertApplication(application, input.dependencies.AuthConfigError);
  const secret = requireSecret(input.environment, input.mode, input.dependencies);
  const baseURL = input.dependencies.required(
    input.environment,
    "CAPACITYLENS_PUBLIC_URL",
    `CAPACITYLENS_MODE=${input.mode}`,
  );
  const publicUrl = parsePublicUrl(baseURL, input.runtimeEnvironment, input.dependencies.AuthConfigError);
  return {
    ...input,
    application,
    secret,
    baseURL,
    publicUrl,
    mail: input.environment.CAPACITYLENS_MAIL_HOST ? createMailSender(input.environment) : null,
    sessionDeletionLifecycleRef: { current: null },
  };
}

// Retain one facade-owned error class and policy surface without a runtime cycle.
export function createAuthFromEnvironmentFactory(dependencies: FactoryDependencies) {
  /** Build the Better Auth instance for the parsed mode, or null in 'off' mode, where no
   * env beyond CAPACITYLENS_MODE itself is read. `trustedOrigins` should be the same browser
   * origins the CORS allow-list names (Better Auth checks Origin on state-changing calls);
   * the same-origin production deploy needs none.
   *
   * Cookie security is derived from `CAPACITYLENS_PUBLIC_URL`, the browser-facing public origin. It must
   * never be tied to whether the Node hop itself terminates TLS: the normal nginx deployment uses
   * HTTPS in the browser and HTTP between nginx and Node. */
  return function authFromEnv(
    db: Db,
    environment: Env,
    options: AuthFromEnvOptions = {},
  ): { mode: AccountMode; auth: Auth | null } {
    const runtimeEnvironment = environment.NODE_ENV ?? process.env.NODE_ENV;
    const resolvedEnvironment = resolveAccountEnvironment(environment).env;
    const mode = dependencies.parseAuthMode(resolvedEnvironment.CAPACITYLENS_MODE);
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
  const { db, environment, mode, application, options, dependencies } = context;
  const pluginOptions = buildPlugins({
    mode,
    totpIssuer: application.branding.totpIssuer,
  });
  // Signup is invite-only by default. The before hook checks the live user count and
  // setup token, allowing exactly one first-owner bootstrap; static disableSignUp would
  // leave signup open after that owner existed. ALLOW_OPEN_SIGNUP remains the explicit
  // trusted-instance/dev override. External principals still require provider admission.
  const allowOpenSignup = environment.CAPACITYLENS_ALLOW_OPEN_SIGNUP === "1";
  const setupToken = requireSetupToken(environment, mode, dependencies.AuthConfigError);
  const providerConfig = buildProviders({
    env: environment,
    enabled: allowsProviderSignIn(mode),
    trustedOrigins: options.trustedOrigins,
    AuthConfigError: dependencies.AuthConfigError,
    db,
    microsoftProof,
  });
  if (allowsProviderSignIn(mode) && providerConfig.configuredProviderInfo.length === 0) {
    throw new dependencies.AuthConfigError(
      `CAPACITYLENS_MODE=${mode} requires at least one configured sign-in provider.`,
    );
  }
  if (mode === "sso-only" && companyProviderIds(providerConfig.configuredProviderInfo).size === 0) {
    throw new dependencies.AuthConfigError(
      "CAPACITYLENS_MODE=sso-only requires Google or tenant-specific Microsoft; GitHub is experimental.",
    );
  }
  return { pluginOptions, allowOpenSignup, setupToken, providerConfig };
}

function browserAuthErrorTarget(publicUrl: URL): URL {
  const target = new URL("/", publicUrl);
  target.searchParams.set("externalSignInError", "1");
  return target;
}

// eslint-disable-next-line max-lines-per-function -- All Better Auth policy hooks remain assembled at this existing boundary.
function buildAuthPolicies(
  context: EnabledAuthContext,
  providers: ReturnType<typeof buildProviderPolicies>,
  microsoftProof: MicrosoftProof | null,
) {
  const { db, environment, runtimeEnvironment, mode, application, secret, baseURL, publicUrl, options, dependencies } =
    context;
  const passwordPolicy = buildPasswordPolicy({
    env: environment,
    mode,
    runtimeEnvironment,
    passwordContextWords: application.branding.passwordContextWords,
    passwordResetSessionCapture,
    sessionDeletionLifecycleRef: context.sessionDeletionLifecycleRef,
    captureResetToken: (input) => captureResetToken(input, context),
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
    configuredFederatedIssuers: providers.providerConfig.configuredFederatedIssuers,
    permittedCompanyProviderIds: companyProviderIds(providers.providerConfig.configuredProviderInfo),
    allowOpenSignup: providers.allowOpenSignup,
    externalIdentityAdmission: async (candidate) =>
      microsoftProof?.admitsNewJoiningIdentity(candidate) === true ||
      (await options.externalIdentityAdmission?.(candidate)) === true,
    onFederatedSession: (principalId: string, providerId: string) => {
      if (providerId === "microsoft") microsoftProof?.bindJoiningSession(principalId);
      options.joiningProviderCallbacks?.bindSession({
        principalId,
        facts: currentJoiningProviderFacts(providerId),
      });
    },
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
    prepareSignUpPasswordHash: passwordPolicy.prepareSignUpPasswordHash,
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
    // An empty object means no provider is configured.
    socialProviders: providerConfig.configuredSocialProviders,
    hooks: requestHookOptions.hooks,
    plugins: pluginOptions.plugins,
    trustedOrigins: providerConfig.trustedOrigins,
    advanced: sessionPolicy.advanced,
    session: sessionPolicy.session,
    telemetry: sessionPolicy.telemetry,
  });
  gateLibraryTransactions(instance, db);
  return instance;
}

function buildEnabledAuth(context: EnabledAuthContext): { mode: AccountMode; auth: Auth } {
  let activeAuth: Auth | null = null;
  const microsoftProof = allowsProviderSignIn(context.mode)
    ? createConfiguredMicrosoftProof({
        db: context.db,
        environment: context.environment,
        mail: context.mail,
        secret: context.secret,
        publicUrl: context.publicUrl,
        applicationId: context.application.applicationId,
        trustedOrigins: context.options.trustedOrigins ?? [],
        AuthConfigError: context.dependencies.AuthConfigError,
        getAuth: () => activeAuth,
      })
    : null;
  const providers = buildProviderPolicies(context, microsoftProof);
  const policies = buildAuthPolicies(context, providers, microsoftProof);
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
    sessionDeletionLifecycleRef: context.sessionDeletionLifecycleRef,
    microsoftProof,
    mail: context.mail,
    ...(context.options.joiningProviderCallbacks === undefined
      ? {}
      : {
          joiningProviderCallbacks: context.options.joiningProviderCallbacks,
        }),
  });
  activeAuth = auth;
  if (!context.options.deferDatabaseSetup) auth.ensureProviderBindings();
  return { mode: context.mode, auth };
}
