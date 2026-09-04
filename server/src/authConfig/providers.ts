import type { AsyncLocalStorage } from "node:async_hooks";
import { APIError } from "better-auth/api";
import type { BetterAuthPlugin } from "better-auth";
import type { SocialProviders } from "better-auth/social-providers";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import type { Db } from "../db";
import { accountConfigKey } from "../accountConfig";
import { createStrictOidcClient, isLoopbackHostname, StrictOidcVerificationError } from "../strictOidc";
import type { AuthProviderInfo } from "../auth";
import type { AuthConfigError } from "../auth";

type Env = Record<string, string | undefined>;
type AuthConfigErrorConstructor = typeof AuthConfigError;
function optionalPair(env: Env, idKey: string, secretKey: string, label: string, E: AuthConfigErrorConstructor) {
  const id = env[idKey];
  const secret = env[secretKey];
  if (!id && !secret) return null;
  if (!id || !secret) {
    throw new E(`${accountConfigKey(idKey)} and ${accountConfigKey(secretKey)} must both be set to enable ${label}.`);
  }
  return [id, secret];
}

function secureProviderUrl(env: Env, key: string, ErrorType: AuthConfigErrorConstructor): string | undefined {
  const raw = env[key]?.trim();
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch (cause) {
    throw new ErrorType(`${accountConfigKey(key)} must be an absolute URL.`, { cause });
  }
  const loopback = isLoopbackHostname(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new ErrorType(`${accountConfigKey(key)} must use https:// (loopback http:// is allowed for development).`);
  }
  if (url.username || url.password) {
    throw new ErrorType(`${accountConfigKey(key)} must not contain URL credentials.`);
  }
  // Issuer identifiers are exact strings in OIDC. URL#toString() adds a trailing slash to a bare
  // origin, which would turn a correct configured `https://idp.example` issuer into a different
  // identity namespace and reject otherwise matching discovery metadata. Validate through URL,
  // but preserve the operator's trimmed value verbatim for protocol comparison.
  return raw;
}

/** Native social providers assembled from env. Unset pairs are absent; a partial pair refuses
 * startup. New external identities are separately verified and invite-gated in the database hook. */
function socialProvidersFromEnv(env: Env, AuthConfigError: AuthConfigErrorConstructor): SocialProviders {
  const providers: SocialProviders = {};
  const configuredPair = (idKey: string, secretKey: string, label: string) =>
    optionalPair(env, idKey, secretKey, label, AuthConfigError);
  const google = configuredPair("CAPACITYLENS_GOOGLE_CLIENT_ID", "CAPACITYLENS_GOOGLE_CLIENT_SECRET", "Google sign-in");
  if (google) providers.google = { clientId: google[0], clientSecret: google[1] };
  const microsoft = configuredPair(
    "CAPACITYLENS_MICROSOFT_CLIENT_ID",
    "CAPACITYLENS_MICROSOFT_CLIENT_SECRET",
    "Microsoft sign-in",
  );
  if (microsoft) {
    // tenantId defaults to 'common' (multi-tenant) when not pinned to a single Entra tenant.
    providers.microsoft = {
      clientId: microsoft[0],
      clientSecret: microsoft[1],
      tenantId: env.CAPACITYLENS_MICROSOFT_TENANT_ID || "common",
    };
  }
  const github = configuredPair("CAPACITYLENS_GITHUB_CLIENT_ID", "CAPACITYLENS_GITHUB_CLIENT_SECRET", "GitHub sign-in");
  if (github) providers.github = { clientId: github[0], clientSecret: github[1] };
  return providers;
}

// Provider ids are persisted as part of an external identity's namespace. Generic OIDC must not
// claim an id owned by a built-in sign-in method or one of CapacityLens' installed auth plugins:
// enabling that method later would otherwise reinterpret existing accounts or overwrite issuer
// routing. Keep this list aligned with socialProvidersFromEnv() and the plugins assembled below.
const RESERVED_IDS = new Set(["credential", "generic-oauth", "two-factor", "google", "microsoft", "github"]);

function externalProviderInfo(
  env: Env,
  genericProviderId: string | null,
  defaultProviderLabel: string,
): AuthProviderInfo[] {
  const providers: AuthProviderInfo[] = [];
  const addSocialProvider = (id: string, label: string): void => {
    providers.push({ id, label, kind: "social", experimental: true });
  };
  if (env.CAPACITYLENS_GOOGLE_CLIENT_ID && env.CAPACITYLENS_GOOGLE_CLIENT_SECRET) {
    addSocialProvider("google", "Google");
  }
  if (env.CAPACITYLENS_MICROSOFT_CLIENT_ID && env.CAPACITYLENS_MICROSOFT_CLIENT_SECRET) {
    addSocialProvider("microsoft", "Microsoft");
  }
  if (env.CAPACITYLENS_GITHUB_CLIENT_ID && env.CAPACITYLENS_GITHUB_CLIENT_SECRET) {
    addSocialProvider("github", "GitHub");
  }
  if (genericProviderId) {
    providers.push({
      id: genericProviderId,
      label: env.CAPACITYLENS_SSO_LABEL?.trim() || defaultProviderLabel,
      kind: "oidc",
      experimental: false,
    });
  }
  return providers;
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
}: {
  db: Db;
  env: Env;
  mode: "password" | "sso";
  publicUrl: URL;
  authHandlerErrorCapture: AsyncLocalStorage<{ error: unknown }>;
  AuthConfigError: AuthConfigErrorConstructor;
  required: (env: Env, key: string, context: string) => string;
  assertStrictOidcEmailAdmission: (
    db: Db,
    providerId: string,
    profile: { sub: string; emailVerified: boolean },
  ) => void;
}) {
  // Generic OAuth/OIDC is additive in password mode and exclusive in sso mode. This lets an
  // installation keep a password fallback while trialling SSO, then switch to SSO-only without
  // changing provider configuration.
  const genericSsoConfigured = Boolean(env.CAPACITYLENS_SSO_CLIENT_ID || env.CAPACITYLENS_SSO_CLIENT_SECRET);
  if (genericSsoConfigured) {
    optionalPair(env, "CAPACITYLENS_SSO_CLIENT_ID", "CAPACITYLENS_SSO_CLIENT_SECRET", "generic SSO", AuthConfigError);
  }
  if (mode === "sso" && !genericSsoConfigured) {
    throw new AuthConfigError(
      "SMALLSASS_ACCOUNT_MODE=sso requires SMALLSASS_ACCOUNT_OIDC_CLIENT_ID and SMALLSASS_ACCOUNT_OIDC_CLIENT_SECRET.",
    );
  }
  const genericProviderId = genericSsoConfigured ? env.CAPACITYLENS_SSO_PROVIDER_ID || "sso" : null;
  if (genericProviderId && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(genericProviderId)) {
    throw new AuthConfigError("SMALLSASS_ACCOUNT_OIDC_PROVIDER_ID must match ^[a-z0-9][a-z0-9_-]{0,63}$.");
  }
  if (genericProviderId && RESERVED_IDS.has(genericProviderId)) {
    throw new AuthConfigError(
      `SMALLSASS_ACCOUNT_OIDC_PROVIDER_ID must not use reserved provider id "${genericProviderId}".`,
    );
  }
  const discoveryUrl = secureProviderUrl(env, "CAPACITYLENS_SSO_DISCOVERY_URL", AuthConfigError);
  const genericIssuer = secureProviderUrl(env, "CAPACITYLENS_SSO_ISSUER", AuthConfigError);
  if (genericIssuer) {
    const issuerUrl = new URL(genericIssuer);
    if (issuerUrl.search || issuerUrl.hash) {
      throw new AuthConfigError("SMALLSASS_ACCOUNT_OIDC_ISSUER must not contain a query string or fragment.");
    }
  }
  const authorizationUrl = secureProviderUrl(env, "CAPACITYLENS_SSO_AUTHORIZATION_URL", AuthConfigError);
  const tokenUrl = secureProviderUrl(env, "CAPACITYLENS_SSO_TOKEN_URL", AuthConfigError);
  let strictOidcClient: ReturnType<typeof createStrictOidcClient> | null = null;
  let strictOidcAuthorizationProxyPath: string | null = null;
  let genericOidcPlugin: BetterAuthPlugin | null = null;
  if (genericProviderId) {
    if (!genericIssuer) {
      throw new AuthConfigError(
        "Strict OIDC requires SMALLSASS_ACCOUNT_OIDC_ISSUER for stable issuer-and-subject identity correlation.",
      );
    }
    const scopes = (env.CAPACITYLENS_SSO_SCOPES ?? "openid profile email").split(/\s+/).filter(Boolean);
    const missingScopes = ["openid", "profile", "email"].filter((scope) => !scopes.includes(scope));
    if (missingScopes.length > 0) {
      throw new AuthConfigError(
        `Generic OIDC requires the ${missingScopes.join(", ")} scope${missingScopes.length === 1 ? "" : "s"}.`,
      );
    }
    if (!discoveryUrl) {
      throw new AuthConfigError(
        "Strict OIDC requires SMALLSASS_ACCOUNT_OIDC_DISCOVERY_URL; endpoint-only generic OAuth is not accepted.",
      );
    }
    if (authorizationUrl || tokenUrl) {
      throw new AuthConfigError(
        "Strict OIDC endpoints must come from discovery; explicit authorization and token endpoint overrides are not accepted.",
      );
    }
    const genericClientId = required(env, "CAPACITYLENS_SSO_CLIENT_ID", "generic SSO");
    const genericClientSecret = required(env, "CAPACITYLENS_SSO_CLIENT_SECRET", "generic SSO");
    strictOidcClient = createStrictOidcClient({
      issuer: genericIssuer,
      clientId: genericClientId,
      clientSecret: genericClientSecret,
      discoveryUrl,
    });
    strictOidcAuthorizationProxyPath = `/api/auth/oidc/authorize/${genericProviderId}`;
    const oidcClient = strictOidcClient;
    genericOidcPlugin = genericOAuth({
      config: [
        {
          providerId: genericProviderId,
          clientId: genericClientId,
          clientSecret: genericClientSecret,
          // Do not give the generic plugin the discovery URL: it consumes discovery endpoints before
          // validating their issuer or transport. Its generated authorization request instead visits
          // our same-origin proxy below, and its code exchange delegates to the same issuer-pinned
          // metadata object. No browser redirect or client secret crosses an unvalidated endpoint.
          authorizationUrl: new URL(strictOidcAuthorizationProxyPath, publicUrl).toString(),
          // genericOAuth shape-validates a token URL while creating the authorization response even
          // when a custom getToken owns exchange. Keep that required placeholder same-origin; it is
          // never requested because getToken below always resolves the validated discovery endpoint.
          tokenUrl: new URL(`/api/auth/oidc/token/${genericProviderId}`, publicUrl).toString(),
          issuer: genericIssuer,
          // RFC 9207's authorization-response `iss` parameter is optional and is not emitted by
          // otherwise-conformant providers such as Dex. Do not make that extension a portability
          // requirement. The trust decision remains strict: discovery is issuer-pinned and
          // strictOidcUserInfo verifies the signed ID token's issuer and client audience before
          // accepting any identity claims.
          requireIssuerValidation: false,
          pkce: true,
          getToken: oidcClient.exchangeCode,
          getUserInfo: async (tokens) => {
            try {
              const profile = await oidcClient.getUserInfo(tokens);
              assertStrictOidcEmailAdmission(db, genericProviderId, profile);
              return profile;
            } catch (error) {
              if (!(error instanceof StrictOidcVerificationError)) throw error;
              console.error("Strict OIDC identity verification failed.", error);
              // generic-oauth performs its browser redirect only when getUserInfo returns no
              // profile. Preserve our stable reason in request-local state so the outer callback
              // seam can replace generic-oauth's `user_info_is_missing` redirect without
              // throwing an APIError that escapes to the browser as raw JSON.
              const capture = authHandlerErrorCapture.getStore();
              if (capture) {
                capture.error = APIError.from("UNAUTHORIZED", {
                  message: "The identity provider response could not be verified.",
                  code: "OIDC_IDENTITY_VERIFICATION_FAILED",
                });
              }
              return null;
            }
          },
          scopes,
        },
      ],
    });
  }

  return {
    genericProviderId,
    genericIssuer,
    strictOidcClient,
    strictOidcAuthorizationProxyPath,
    genericOidcPlugin,
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
  const configuredSocialProviders = socialProvidersFromEnv(env, AuthConfigError);
  const configuredProviderInfo = externalProviderInfo(env, prepared.genericProviderId, defaultProviderLabel);
  // Experimental social providers still receive a stable issuer namespace so identity
  // correlation is always (issuer, subject), never email or a mutable display label. Generic
  // OIDC uses its actual issuer URL and remains the first-class path.
  const configuredFederatedIssuers = new Map<string, string>();
  if (configuredSocialProviders.google) configuredFederatedIssuers.set("google", "https://accounts.google.com");
  if (configuredSocialProviders.microsoft) {
    configuredFederatedIssuers.set(
      "microsoft",
      `urn:better-auth:microsoft:${env.CAPACITYLENS_MICROSOFT_TENANT_ID || "common"}`,
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
