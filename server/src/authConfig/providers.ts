import type { AsyncLocalStorage } from "node:async_hooks";
import { APIError } from "better-auth/api";
import type { SocialProviders } from "better-auth/social-providers";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import type { Db } from "../db";
import { resolveAccountConfigKey } from "../accountConfig";
import { createStrictOidcClient, isLoopbackHostname, StrictOidcVerificationError } from "../strictOidc";
import type { AuthConfigError, AuthProviderInfo } from "../auth";

type Env = Record<string, string | undefined>;
type AuthConfigErrorConstructor = typeof AuthConfigError;

function resolveNonEmptyValue(value: string | undefined, fallback: string): string {
  if (value) return value;
  return fallback;
}

interface ParseOptionalCredentialPairInput {
  environment: Env;
  idKey: string;
  secretKey: string;
  label: string;
  E: AuthConfigErrorConstructor;
}
function parseOptionalCredentialPair({
  environment,
  idKey,
  secretKey,
  label,
  E,
}: ParseOptionalCredentialPairInput): [clientId: string, clientSecret: string] | null {
  const id = environment[idKey];
  const secret = environment[secretKey];
  if (!id && !secret) return null;
  if (!id || !secret) {
    throw new E(
      `${resolveAccountConfigKey(idKey)} and ${resolveAccountConfigKey(secretKey)} must both be set to enable ${label}.`,
    );
  }
  return [id, secret];
}

function parseSecureProviderUrl(
  environment: Env,
  key: string,
  ErrorType: AuthConfigErrorConstructor,
): string | undefined {
  const raw = environment[key]?.trim();
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch (cause) {
    throw new ErrorType(`${resolveAccountConfigKey(key)} must be an absolute URL.`, { cause });
  }
  const loopback = isLoopbackHostname(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new ErrorType(
      `${resolveAccountConfigKey(key)} must use https:// (loopback http:// is allowed for development).`,
    );
  }
  if (url.username || url.password) {
    throw new ErrorType(`${resolveAccountConfigKey(key)} must not contain URL credentials.`);
  }
  // Validate through URL but preserve the trimmed issuer verbatim: URL#toString() can add a slash
  // and change the exact OIDC identity namespace.
  return raw;
}

/** Builds social providers; partial credentials refuse startup and identity admission stays database-gated. */
function parseSocialProvidersFromEnvironment(
  environment: Env,
  AuthConfigError: AuthConfigErrorConstructor,
): SocialProviders {
  const providers: SocialProviders = {};
  const parseConfiguredPair = (idKey: string, secretKey: string, label: string) =>
    parseOptionalCredentialPair({ environment, idKey, secretKey, label, E: AuthConfigError });
  const google = parseConfiguredPair(
    "CAPACITYLENS_GOOGLE_CLIENT_ID",
    "CAPACITYLENS_GOOGLE_CLIENT_SECRET",
    "Google sign-in",
  );
  if (google) {
    const [clientId, clientSecret] = google;
    providers.google = { clientId, clientSecret };
  }
  const microsoft = parseConfiguredPair(
    "CAPACITYLENS_MICROSOFT_CLIENT_ID",
    "CAPACITYLENS_MICROSOFT_CLIENT_SECRET",
    "Microsoft sign-in",
  );
  if (microsoft) {
    const [clientId, clientSecret] = microsoft;
    // tenantId defaults to 'common' (multi-tenant) when not pinned to a single Entra tenant.
    providers.microsoft = {
      clientId,
      clientSecret,
      tenantId: resolveNonEmptyValue(environment.CAPACITYLENS_MICROSOFT_TENANT_ID, "common"),
    };
  }
  const github = parseConfiguredPair(
    "CAPACITYLENS_GITHUB_CLIENT_ID",
    "CAPACITYLENS_GITHUB_CLIENT_SECRET",
    "GitHub sign-in",
  );
  if (github) {
    const [clientId, clientSecret] = github;
    providers.github = { clientId, clientSecret };
  }
  return providers;
}

// Provider ids persist as identity namespaces, so generic OIDC must not claim a built-in/plugin id.
// Keep this aligned with social-provider parsing and plugin assembly.
const RESERVED_IDS = new Set(["credential", "generic-oauth", "two-factor", "google", "microsoft", "github"]);

function buildExternalProviderInfo(
  environment: Env,
  genericProviderId: string | null,
  defaultProviderLabel: string,
): AuthProviderInfo[] {
  const providers: AuthProviderInfo[] = [];
  const addSocialProvider = (id: string, label: string): void => {
    providers.push({ id, label, kind: "social", experimental: true });
  };
  if (environment.CAPACITYLENS_GOOGLE_CLIENT_ID && environment.CAPACITYLENS_GOOGLE_CLIENT_SECRET) {
    addSocialProvider("google", "Google");
  }
  if (environment.CAPACITYLENS_MICROSOFT_CLIENT_ID && environment.CAPACITYLENS_MICROSOFT_CLIENT_SECRET) {
    addSocialProvider("microsoft", "Microsoft");
  }
  if (environment.CAPACITYLENS_GITHUB_CLIENT_ID && environment.CAPACITYLENS_GITHUB_CLIENT_SECRET) {
    addSocialProvider("github", "GitHub");
  }
  if (genericProviderId) {
    providers.push({
      id: genericProviderId,
      label: resolveNonEmptyValue(environment.CAPACITYLENS_SSO_LABEL?.trim(), defaultProviderLabel),
      kind: "oidc",
      experimental: false,
    });
  }
  return providers;
}

interface PrepareProvidersInput {
  db: Db;
  env: Env;
  mode: "password" | "sso";
  publicUrl: URL;
  authHandlerErrorCapture: AsyncLocalStorage<{ error: unknown }>;
  AuthConfigError: AuthConfigErrorConstructor;
  required: (environment: Env, key: string, context: string) => string;
  assertStrictOidcEmailAdmission: (
    db: Db,
    providerId: string,
    profile: { sub: string; emailVerified: boolean },
  ) => void;
}

interface GenericOidcConfiguration {
  providerId: string;
  issuer: string;
  discoveryUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
}

interface ParsedGenericOidcConfiguration {
  configuration: GenericOidcConfiguration | null;
  issuer: string | undefined;
}

function resolveGenericProviderId(
  env: Env,
  mode: "password" | "sso",
  AuthConfigError: AuthConfigErrorConstructor,
): string | null {
  const configured = [env.CAPACITYLENS_SSO_CLIENT_ID, env.CAPACITYLENS_SSO_CLIENT_SECRET].some(Boolean);
  if (configured) {
    parseOptionalCredentialPair({
      environment: env,
      idKey: "CAPACITYLENS_SSO_CLIENT_ID",
      secretKey: "CAPACITYLENS_SSO_CLIENT_SECRET",
      label: "generic SSO",
      E: AuthConfigError,
    });
  }
  if (mode === "sso" && !configured) {
    throw new AuthConfigError(
      "SMALLSASS_ACCOUNT_MODE=sso requires SMALLSASS_ACCOUNT_OIDC_CLIENT_ID and SMALLSASS_ACCOUNT_OIDC_CLIENT_SECRET.",
    );
  }
  if (!configured) return null;
  const providerId = resolveNonEmptyValue(env.CAPACITYLENS_SSO_PROVIDER_ID, "sso");
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(providerId)) {
    throw new AuthConfigError("SMALLSASS_ACCOUNT_OIDC_PROVIDER_ID must match ^[a-z0-9][a-z0-9_-]{0,63}$.");
  }
  if (RESERVED_IDS.has(providerId)) {
    throw new AuthConfigError(`SMALLSASS_ACCOUNT_OIDC_PROVIDER_ID must not use reserved provider id "${providerId}".`);
  }
  return providerId;
}

function parseRequiredOidcScopes(env: Env, AuthConfigError: AuthConfigErrorConstructor): string[] {
  const scopes = (env.CAPACITYLENS_SSO_SCOPES ?? "openid profile email").split(/\s+/).filter(Boolean);
  const missingScopes = ["openid", "profile", "email"].filter((scope) => !scopes.includes(scope));
  if (missingScopes.length > 0) {
    throw new AuthConfigError(
      `Generic OIDC requires the ${missingScopes.join(", ")} scope${missingScopes.length === 1 ? "" : "s"}.`,
    );
  }
  return scopes;
}

function parseGenericOidcConfiguration({
  env,
  mode,
  AuthConfigError,
  required,
}: Pick<PrepareProvidersInput, "env" | "mode" | "AuthConfigError" | "required">): ParsedGenericOidcConfiguration {
  const providerId = resolveGenericProviderId(env, mode, AuthConfigError);
  const discoveryUrl = parseSecureProviderUrl(env, "CAPACITYLENS_SSO_DISCOVERY_URL", AuthConfigError);
  const issuer = parseSecureProviderUrl(env, "CAPACITYLENS_SSO_ISSUER", AuthConfigError);
  if (issuer) {
    const issuerUrl = new URL(issuer);
    if (issuerUrl.search || issuerUrl.hash) {
      throw new AuthConfigError("SMALLSASS_ACCOUNT_OIDC_ISSUER must not contain a query string or fragment.");
    }
  }
  const authorizationUrl = parseSecureProviderUrl(env, "CAPACITYLENS_SSO_AUTHORIZATION_URL", AuthConfigError);
  const tokenUrl = parseSecureProviderUrl(env, "CAPACITYLENS_SSO_TOKEN_URL", AuthConfigError);
  if (!providerId) return { configuration: null, issuer };
  if (!issuer) {
    throw new AuthConfigError(
      "Strict OIDC requires SMALLSASS_ACCOUNT_OIDC_ISSUER for stable issuer-and-subject identity correlation.",
    );
  }
  const scopes = parseRequiredOidcScopes(env, AuthConfigError);
  if (!discoveryUrl) {
    throw new AuthConfigError(
      "Strict OIDC requires SMALLSASS_ACCOUNT_OIDC_DISCOVERY_URL; endpoint-only generic OAuth is not accepted.",
    );
  }
  if ([authorizationUrl, tokenUrl].some(Boolean)) {
    throw new AuthConfigError(
      "Strict OIDC endpoints must come from discovery; explicit authorization and token endpoint overrides are not accepted.",
    );
  }
  return {
    issuer,
    configuration: {
      providerId,
      issuer,
      discoveryUrl,
      clientId: required(env, "CAPACITYLENS_SSO_CLIENT_ID", "generic SSO"),
      clientSecret: required(env, "CAPACITYLENS_SSO_CLIENT_SECRET", "generic SSO"),
      scopes,
    },
  };
}

function captureStrictOidcVerificationError(
  error: unknown,
  authHandlerErrorCapture: AsyncLocalStorage<{ error: unknown }>,
): null {
  if (!(error instanceof StrictOidcVerificationError)) throw error;
  console.error("Strict OIDC identity verification failed.", error);
  // Request-local APIError plus null replaces generic-oauth's user_info_is_missing redirect without
  // allowing an exception to escape to the browser as raw JSON.
  const capture = authHandlerErrorCapture.getStore();
  if (capture) {
    capture.error = APIError.from("UNAUTHORIZED", {
      message: "The identity provider response could not be verified.",
      code: "OIDC_IDENTITY_VERIFICATION_FAILED",
    });
  }
  return null;
}

function createGenericOidcPlugin(
  configuration: GenericOidcConfiguration,
  input: Pick<PrepareProvidersInput, "db" | "publicUrl" | "authHandlerErrorCapture" | "assertStrictOidcEmailAdmission">,
) {
  const { providerId, issuer, discoveryUrl, clientId, clientSecret, scopes } = configuration;
  const strictOidcClient = createStrictOidcClient({ issuer, clientId, clientSecret, discoveryUrl });
  const strictOidcAuthorizationProxyPath = `/api/auth/oidc/authorize/${providerId}`;
  const genericOidcPlugin = genericOAuth({
    config: [
      {
        providerId,
        clientId,
        clientSecret,
        // Same-origin proxy keeps the plugin from consuming untrusted discovery before validation.
        authorizationUrl: new URL(strictOidcAuthorizationProxyPath, input.publicUrl).toString(),
        // Shape-only placeholder: custom getToken owns exchange, so this URL is never requested.
        tokenUrl: new URL(`/api/auth/oidc/token/${providerId}`, input.publicUrl).toString(),
        issuer,
        // Dex may omit RFC 9207 `iss`; the strict client still enforces ID-token issuer and audience.
        requireIssuerValidation: false,
        pkce: true,
        getToken: ({ code, redirectURI, codeVerifier }) =>
          strictOidcClient.exchangeCode({
            code,
            redirectURI,
            ...(codeVerifier === undefined ? {} : { codeVerifier }),
          }),
        getUserInfo: async (tokens) => {
          try {
            const profile = await strictOidcClient.getUserInfo({
              ...(tokens.accessToken === undefined ? {} : { accessToken: tokens.accessToken }),
              ...(tokens.idToken === undefined ? {} : { idToken: tokens.idToken }),
            });
            input.assertStrictOidcEmailAdmission(input.db, providerId, profile);
            return profile;
          } catch (error) {
            return captureStrictOidcVerificationError(error, input.authHandlerErrorCapture);
          }
        },
        scopes,
      },
    ],
  });
  return { strictOidcClient, strictOidcAuthorizationProxyPath, genericOidcPlugin };
}

export function prepareProviders({
  db,
  env,
  mode,
  publicUrl,
  authHandlerErrorCapture,
  AuthConfigError,
  required,
  assertStrictOidcEmailAdmission,
}: PrepareProvidersInput) {
  // Generic OAuth/OIDC is additive in password mode and exclusive in sso mode. This lets an
  // installation keep a password fallback while trialling SSO, then switch to SSO-only without
  // changing provider configuration.
  const { configuration, issuer } = parseGenericOidcConfiguration({ env, mode, AuthConfigError, required });
  const preparedGenericOidc = configuration
    ? createGenericOidcPlugin(configuration, {
        db,
        publicUrl,
        authHandlerErrorCapture,
        assertStrictOidcEmailAdmission,
      })
    : { strictOidcClient: null, strictOidcAuthorizationProxyPath: null, genericOidcPlugin: null };

  return {
    genericProviderId: configuration?.providerId ?? null,
    genericIssuer: issuer,
    ...preparedGenericOidc,
  };
}

export function buildProviders({
  env,
  defaultProviderLabel,
  trustedOrigins,
  prepared,
  AuthConfigError,
}: {
  env: Env;
  defaultProviderLabel: string;
  trustedOrigins: string[] | undefined;
  prepared: ReturnType<typeof prepareProviders>;
  AuthConfigError: AuthConfigErrorConstructor;
}) {
  // Resolve every remaining provider configuration before the first explicit database DDL below.
  // An invalid provider/URL must not leave a bootstrap-control table behind on an otherwise
  // untouched database merely because validation happened in an unfortunate order.
  const configuredSocialProviders = parseSocialProvidersFromEnvironment(env, AuthConfigError);
  const configuredProviderInfo = buildExternalProviderInfo(env, prepared.genericProviderId, defaultProviderLabel);
  // Experimental social providers still receive a stable issuer namespace so identity
  // correlation is always (issuer, subject), never email or a mutable display label. Generic
  // OIDC uses its actual issuer URL and remains the first-class path.
  const configuredFederatedIssuers = new Map<string, string>();
  if (configuredSocialProviders.google) configuredFederatedIssuers.set("google", "https://accounts.google.com");
  if (configuredSocialProviders.microsoft) {
    configuredFederatedIssuers.set(
      "microsoft",
      `urn:better-auth:microsoft:${resolveNonEmptyValue(env.CAPACITYLENS_MICROSOFT_TENANT_ID, "common")}`,
    );
  }
  if (configuredSocialProviders.github) configuredFederatedIssuers.set("github", "urn:better-auth:github");
  if (prepared.genericProviderId && prepared.genericIssuer) {
    configuredFederatedIssuers.set(prepared.genericProviderId, prepared.genericIssuer);
  }

  return {
    ...prepared,
    configuredSocialProviders,
    configuredProviderInfo,
    configuredFederatedIssuers,
    trustedOrigins,
  };
}
