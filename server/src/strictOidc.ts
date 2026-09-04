import { createRemoteJWKSet, customFetch, jwtVerify, type JWTPayload } from "jose";
import { authorizationCodeRequest, getOAuth2Tokens } from "better-auth/oauth2";
import { isAccountEmail, normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import { MAX_NAME_LENGTH, unicodeCharacterCount } from "@capacitylens/shared/lib/strings";
import { assertFetchableEndpoint, issuerIsInternal } from "./authConfig/strictOidcAddressPolicy";
import {
  ACCEPTED_SIGNING_ALGORITHMS,
  StrictOidcConfigError,
  StrictOidcVerificationError,
  StrictOidcProviderUnavailableError,
  type StrictOidcMetadata,
  type OidcTokens,
  type StrictOidcProfile,
  type StrictOidcClient,
} from "./authConfig/strictOidcErrors";
import { object, requiredUrl, optionalPictureUrl, json } from "./authConfig/strictOidcFetch";

// Keep the Better Auth dependency here while the extracted client contract refers to its exact type.
export type { getOAuth2Tokens };
export {
  StrictOidcConfigError,
  StrictOidcVerificationError,
  StrictOidcProviderUnavailableError,
  type StrictOidcMetadata,
  type StrictOidcClient,
} from "./authConfig/strictOidcErrors";
export { isLoopbackHostname } from "./authConfig/strictOidcAddressPolicy";

/**
 * Strict OIDC profile resolver used by the supported generic provider path.
 *
 * Better Auth continues to own state, PKCE, cookies and local account persistence. This adapter
 * replaces permissive discovery/profile decoding and exchange-endpoint selection with one
 * issuer-pinned endpoint view shared by the browser redirect, bounded code exchange and claim
 * checks; signed ID-token validation, client audience validation, remotely refreshed JWKS, and a
 * user-info `sub` equality check. Email remains an admission attribute and is never the link key.
 */
export function createStrictOidcClient(input: {
  issuer: string;
  clientId: string;
  clientSecret?: string;
  discoveryUrl: string;
}): StrictOidcClient {
  const metadataTtlMs = 5 * 60 * 1_000;
  let metadataPromise: Promise<StrictOidcMetadata> | null = null;
  let metadataCache: { value: StrictOidcMetadata; expiresAt: number } | null = null;
  let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  const metadata = async (): Promise<StrictOidcMetadata> => {
    if (metadataCache && Date.now() < metadataCache.expiresAt) return metadataCache.value;
    if (!metadataPromise)
      metadataPromise = (async () => {
        const body = object(await json(input.discoveryUrl));
        if (!body) throw new StrictOidcConfigError("OIDC discovery returned a non-object document.");
        if (body.issuer !== input.issuer) {
          throw new StrictOidcConfigError("OIDC discovery issuer does not match the configured issuer.");
        }
        const responseTypes = Array.isArray(body.response_types_supported)
          ? body.response_types_supported.filter((value): value is string => typeof value === "string")
          : [];
        if (!responseTypes.includes("code")) {
          throw new StrictOidcConfigError("OIDC discovery does not advertise the authorization-code response type.");
        }
        const subjectTypes = Array.isArray(body.subject_types_supported)
          ? body.subject_types_supported.filter((value): value is string => typeof value === "string")
          : [];
        if (!subjectTypes.some((value) => value === "public" || value === "pairwise")) {
          throw new StrictOidcConfigError("OIDC discovery offers no supported public or pairwise subject type.");
        }
        const algorithms = Array.isArray(body.id_token_signing_alg_values_supported)
          ? body.id_token_signing_alg_values_supported.filter((value): value is string => typeof value === "string")
          : [];
        const allowedSigningAlgorithms = algorithms.filter((algorithm) =>
          (ACCEPTED_SIGNING_ALGORITHMS as readonly string[]).includes(algorithm),
        );
        if (allowedSigningAlgorithms.length === 0) {
          throw new StrictOidcConfigError("OIDC discovery offers no accepted asymmetric ID-token signing algorithm.");
        }
        const advertisedTokenAuthentication = Array.isArray(body.token_endpoint_auth_methods_supported)
          ? body.token_endpoint_auth_methods_supported.filter((value): value is string => typeof value === "string")
          : null;
        // OIDC Discovery specifies client_secret_basic as the default when this metadata is absent.
        // Prefer it when both common confidential-client methods are advertised; accept post for
        // providers such as development Dex configurations that explicitly select it.
        const tokenEndpointAuthentication =
          advertisedTokenAuthentication === null || advertisedTokenAuthentication.includes("client_secret_basic")
            ? "basic"
            : advertisedTokenAuthentication.includes("client_secret_post")
              ? "post"
              : null;
        if (!tokenEndpointAuthentication) {
          throw new StrictOidcConfigError(
            "OIDC discovery offers no supported confidential-client token endpoint authentication method.",
          );
        }
        const issuerUrl = new URL(input.issuer);
        const issuerOrigin = issuerUrl.origin;
        const authorizationEndpoint = requiredUrl(body.authorization_endpoint, "authorization_endpoint");
        const tokenEndpoint = requiredUrl(body.token_endpoint, "token_endpoint");
        const jwksUri = requiredUrl(body.jwks_uri, "jwks_uri");
        const userinfoEndpoint = requiredUrl(body.userinfo_endpoint, "userinfo_endpoint");
        // Only the three endpoints this server fetches need SSRF containment; the browser dereferences
        // the authorization endpoint. An intentionally internal issuer opts the whole deployment out
        // (split-origin on-prem IdPs). Resolution can hit the network, so it runs once per metadata load.
        const offOriginEndpoints = [
          { url: tokenEndpoint, field: "token_endpoint" },
          { url: jwksUri, field: "jwks_uri" },
          { url: userinfoEndpoint, field: "userinfo_endpoint" },
        ].filter((endpoint) => endpoint.url.origin !== issuerOrigin);
        if (offOriginEndpoints.length > 0 && !(await issuerIsInternal(issuerUrl))) {
          await Promise.all(
            offOriginEndpoints.map((endpoint) => assertFetchableEndpoint(endpoint.url, endpoint.field, issuerOrigin)),
          );
        }
        const result: StrictOidcMetadata = {
          issuer: input.issuer,
          authorization_endpoint: authorizationEndpoint.toString(),
          token_endpoint: tokenEndpoint.toString(),
          jwks_uri: jwksUri.toString(),
          userinfo_endpoint: userinfoEndpoint.toString(),
          allowed_signing_algorithms: allowedSigningAlgorithms,
          token_endpoint_authentication: tokenEndpointAuthentication,
        };
        if (metadataCache && metadataCache.value.jwks_uri !== result.jwks_uri) jwks = null;
        metadataCache = { value: result, expiresAt: Date.now() + metadataTtlMs };
        return result;
      })().finally(() => {
        metadataPromise = null;
      });
    return metadataPromise;
  };

  const exchangeCode = async (codeInput: {
    code: string;
    redirectURI: string;
    codeVerifier?: string;
  }): Promise<ReturnType<typeof getOAuth2Tokens>> => {
    if (!input.clientSecret) {
      throw new StrictOidcConfigError("Strict OIDC code exchange requires a client secret.");
    }
    const discovered = await metadata();
    const request = await authorizationCodeRequest({
      code: codeInput.code,
      redirectURI: codeInput.redirectURI,
      codeVerifier: codeInput.codeVerifier,
      options: { clientId: input.clientId, clientSecret: input.clientSecret },
      authentication: discovered.token_endpoint_authentication,
    });
    const response = object(
      await json(discovered.token_endpoint, {
        method: "POST",
        body: request.body,
        headers: request.headers as Record<string, string>,
      }),
    );
    if (!response) throw new Error("OIDC token endpoint returned a non-object document.");
    return getOAuth2Tokens(response);
  };

  const getUserInfo = async (tokens: OidcTokens): Promise<StrictOidcProfile> => {
    if (!tokens.idToken || !tokens.accessToken) {
      throw new StrictOidcVerificationError("Strict OIDC requires both an ID token and an access token.");
    }
    const discovered = await metadata();
    jwks ??= createRemoteJWKSet(new URL(discovered.jwks_uri), {
      timeoutDuration: 10_000,
      // An unknown `kid` triggers one metadata-backed JWKS refresh immediately. Successful keys
      // remain cached, so this supports normal IdP overlap rotation without polling per request.
      cooldownDuration: 0,
      cacheMaxAge: 10 * 60_000,
      // A JWKS redirect is a new trust decision. Keep key retrieval on the exact endpoint that the
      // already issuer-pinned discovery document named, matching the no-redirect posture used for
      // discovery, user-info and Better Auth's authorization-code exchange.
      [customFetch]: async (url, init) => Response.json(await json(url.toString(), init)),
    });
    let verified: Awaited<ReturnType<typeof jwtVerify>>;
    try {
      verified = await jwtVerify(tokens.idToken, jwks, {
        issuer: input.issuer,
        audience: input.clientId,
        algorithms: discovered.allowed_signing_algorithms,
        requiredClaims: ["sub", "iat", "exp"],
        // This token is consumed immediately after the authorization-code exchange. Constraining its
        // age turns `iat` into a real replay/freshness check rather than a presence-only checkbox.
        maxTokenAge: "10m",
        clockTolerance: 60,
      });
    } catch (cause) {
      const code = cause && typeof cause === "object" ? (cause as { code?: unknown }).code : null;
      if (cause instanceof StrictOidcProviderUnavailableError || code === "ERR_JWKS_TIMEOUT") throw cause;
      const detail = cause instanceof Error ? cause.message : "The token could not be verified.";
      throw new StrictOidcVerificationError(`OIDC ID token verification failed: ${detail}`, { cause });
    }
    const claims: JWTPayload = verified.payload;
    if (claims.azp !== undefined && typeof claims.azp !== "string") {
      throw new StrictOidcVerificationError("OIDC ID token authorized party must be a string.");
    }
    if (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== input.clientId) {
      throw new StrictOidcVerificationError("OIDC ID token with multiple audiences has an invalid authorized party.");
    }
    if (typeof claims.azp === "string" && claims.azp !== input.clientId) {
      throw new StrictOidcVerificationError("OIDC ID token authorized party does not match this client.");
    }
    let userInfo: unknown;
    try {
      userInfo = await json(discovered.userinfo_endpoint, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
    } catch (cause) {
      if (cause instanceof StrictOidcProviderUnavailableError) throw cause;
      throw new StrictOidcVerificationError("OIDC user-info response could not be verified.", { cause });
    }
    const profile = object(userInfo);
    if (!profile || typeof profile.sub !== "string" || profile.sub.length === 0) {
      throw new StrictOidcVerificationError("OIDC user-info response is missing subject.");
    }
    if (profile.sub !== claims.sub) {
      throw new StrictOidcVerificationError("OIDC ID-token and user-info subjects do not match.");
    }
    if (typeof profile.email !== "string") {
      throw new StrictOidcVerificationError("OIDC user-info response is missing email.");
    }
    const email = normalizeAccountEmail(profile.email);
    if (!isAccountEmail(email)) {
      throw new StrictOidcVerificationError("OIDC user-info response contains an invalid email address.");
    }
    if (
      typeof profile.name !== "string" ||
      profile.name.trim().length === 0 ||
      unicodeCharacterCount(profile.name.trim()) > MAX_NAME_LENGTH
    ) {
      throw new StrictOidcVerificationError("OIDC user-info response has a missing or invalid name.");
    }
    return {
      ...profile,
      id: profile.sub,
      sub: profile.sub,
      email,
      emailVerified: profile.email_verified === true,
      name: profile.name.trim(),
      image: optionalPictureUrl(profile.picture),
    };
  };

  return { metadata, exchangeCode, getUserInfo };
}

/** Backwards-compatible narrow resolver used by unit tests and embedded callers that only need
 * claim verification. The production adapter uses one shared client for all three OIDC stages. */
export function strictOidcUserInfo(input: {
  issuer: string;
  clientId: string;
  discoveryUrl: string;
}): (tokens: OidcTokens) => Promise<StrictOidcProfile> {
  return createStrictOidcClient(input).getUserInfo;
}
