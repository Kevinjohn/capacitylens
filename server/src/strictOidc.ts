import { createRemoteJWKSet, customFetch, jwtVerify, type JWTPayload } from "jose";
import { authorizationCodeRequest, getOAuth2Tokens } from "better-auth/oauth2";
import { isAccountEmail, normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import { MAX_NAME_LENGTH, unicodeCharacterCount } from "@capacitylens/shared/lib/strings";
import { assertFetchableEndpoint, isInternalIssuer } from "./authConfig/strictOidcAddressPolicy";
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
import { parseObject, parseRequiredUrl, parseOptionalPictureUrl, readJson } from "./authConfig/strictOidcFetch";

export type { getOAuth2Tokens };
export {
  StrictOidcConfigError,
  StrictOidcVerificationError,
  StrictOidcProviderUnavailableError,
  type StrictOidcMetadata,
  type StrictOidcClient,
} from "./authConfig/strictOidcErrors";
export { isLoopbackHostname } from "./authConfig/strictOidcAddressPolicy";

type StrictOidcInput = { issuer: string; clientId: string; clientSecret?: string; discoveryUrl: string };
type StrictOidcState = {
  metadataPromise: Promise<StrictOidcMetadata> | null;
  metadataCache: { value: StrictOidcMetadata; expiresAt: number } | null;
  jwks: ReturnType<typeof createRemoteJWKSet> | null;
};
const METADATA_TTL_MS = 5 * 60 * 1_000;
const acceptedSigningAlgorithms = new Set<string>(ACCEPTED_SIGNING_ALGORITHMS);

function readStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function readTokenAuthentication(value: unknown): "basic" | "post" {
  // Discovery defaults absent metadata to client_secret_basic; prefer basic when both supported
  // confidential-client methods are advertised, while accepting explicit post-only providers.
  if (!Array.isArray(value) || value.includes("client_secret_basic")) return "basic";
  if (value.includes("client_secret_post")) return "post";
  throw new StrictOidcConfigError(
    "OIDC discovery offers no supported confidential-client token endpoint authentication method.",
  );
}

function validateCapabilities(body: Record<string, unknown>): string[] {
  if (!readStrings(body.response_types_supported).includes("code"))
    throw new StrictOidcConfigError("OIDC discovery does not advertise the authorization-code response type.");
  const subjects = readStrings(body.subject_types_supported);
  if (!subjects.some((value) => value === "public" || value === "pairwise"))
    throw new StrictOidcConfigError("OIDC discovery offers no supported public or pairwise subject type.");
  const algorithms = readStrings(body.id_token_signing_alg_values_supported).filter((value) =>
    acceptedSigningAlgorithms.has(value),
  );
  if (algorithms.length === 0)
    throw new StrictOidcConfigError("OIDC discovery offers no accepted asymmetric ID-token signing algorithm.");
  return algorithms;
}

async function validateEndpoints(issuer: URL, endpoints: Array<{ url: URL; field: string }>): Promise<void> {
  // Only server-fetched endpoints need SSRF containment. An intentionally internal issuer opts the
  // deployment out so split-origin on-premises providers remain supported.
  const external = endpoints.filter(({ url }) => url.origin !== issuer.origin);
  if (external.length === 0 || (await isInternalIssuer(issuer))) return;
  await Promise.all(external.map(({ url, field }) => assertFetchableEndpoint(url, field, issuer.origin)));
}

async function fetchMetadata(input: StrictOidcInput): Promise<StrictOidcMetadata> {
  const body = parseObject(await readJson(input.discoveryUrl));
  if (!body) throw new StrictOidcConfigError("OIDC discovery returned a non-object document.");
  if (body.issuer !== input.issuer)
    throw new StrictOidcConfigError("OIDC discovery issuer does not match the configured issuer.");
  const allowedSigningAlgorithms = validateCapabilities(body);
  const tokenEndpointAuthentication = readTokenAuthentication(body.token_endpoint_auth_methods_supported);
  const authorizationEndpoint = parseRequiredUrl(body.authorization_endpoint, "authorization_endpoint");
  const tokenEndpoint = parseRequiredUrl(body.token_endpoint, "token_endpoint");
  const jwksUri = parseRequiredUrl(body.jwks_uri, "jwks_uri");
  const userinfoEndpoint = parseRequiredUrl(body.userinfo_endpoint, "userinfo_endpoint");
  await validateEndpoints(new URL(input.issuer), [
    { url: tokenEndpoint, field: "token_endpoint" },
    { url: jwksUri, field: "jwks_uri" },
    { url: userinfoEndpoint, field: "userinfo_endpoint" },
  ]);
  return {
    issuer: input.issuer,
    authorization_endpoint: authorizationEndpoint.toString(),
    token_endpoint: tokenEndpoint.toString(),
    jwks_uri: jwksUri.toString(),
    userinfo_endpoint: userinfoEndpoint.toString(),
    allowed_signing_algorithms: allowedSigningAlgorithms,
    token_endpoint_authentication: tokenEndpointAuthentication,
  };
}

async function cacheMetadata(input: StrictOidcInput, state: StrictOidcState): Promise<StrictOidcMetadata> {
  const result = await fetchMetadata(input);
  if (state.metadataCache?.value.jwks_uri !== result.jwks_uri) state.jwks = null;
  state.metadataCache = { value: result, expiresAt: Date.now() + METADATA_TTL_MS };
  return result;
}

function createMetadataReader(input: StrictOidcInput, state: StrictOidcState) {
  return async (): Promise<StrictOidcMetadata> => {
    if (state.metadataCache && Date.now() < state.metadataCache.expiresAt) return state.metadataCache.value;
    state.metadataPromise ??= cacheMetadata(input, state).finally(() => {
      state.metadataPromise = null;
    });
    return state.metadataPromise;
  };
}

function createCodeExchange(
  input: StrictOidcInput,
  readMetadata: () => Promise<StrictOidcMetadata>,
): StrictOidcClient["exchangeCode"] {
  return async (codeInput) => {
    if (!input.clientSecret) throw new StrictOidcConfigError("Strict OIDC code exchange requires a client secret.");
    const discovered = await readMetadata();
    const request = await authorizationCodeRequest({
      code: codeInput.code,
      redirectURI: codeInput.redirectURI,
      codeVerifier: codeInput.codeVerifier,
      options: { clientId: input.clientId, clientSecret: input.clientSecret },
      authentication: discovered.token_endpoint_authentication,
    });
    const response = parseObject(
      await readJson(discovered.token_endpoint, { method: "POST", body: request.body, headers: request.headers }),
    );
    if (!response) throw new Error("OIDC token endpoint returned a non-object document.");
    return getOAuth2Tokens(response);
  };
}

function readErrorCode(cause: unknown): unknown {
  return cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
}

async function verifyToken(options: {
  input: StrictOidcInput;
  metadata: StrictOidcMetadata;
  jwks: ReturnType<typeof createRemoteJWKSet>;
  idToken: string;
}): Promise<JWTPayload> {
  try {
    return (
      await jwtVerify(options.idToken, options.jwks, {
        issuer: options.input.issuer,
        audience: options.input.clientId,
        algorithms: options.metadata.allowed_signing_algorithms,
        requiredClaims: ["sub", "iat", "exp"],
        // Immediate consumption makes the required iat a bounded freshness and replay check.
        maxTokenAge: "10m",
        clockTolerance: 60,
      })
    ).payload;
  } catch (cause) {
    if (cause instanceof StrictOidcProviderUnavailableError || readErrorCode(cause) === "ERR_JWKS_TIMEOUT") throw cause;
    const detail = cause instanceof Error ? cause.message : "The token could not be verified.";
    throw new StrictOidcVerificationError(`OIDC ID token verification failed: ${detail}`, { cause });
  }
}

function validateAuthorizedParty(claims: JWTPayload, clientId: string): void {
  if (claims.azp !== undefined && typeof claims.azp !== "string")
    throw new StrictOidcVerificationError("OIDC ID token authorized party must be a string.");
  if (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== clientId)
    throw new StrictOidcVerificationError("OIDC ID token with multiple audiences has an invalid authorized party.");
  if (typeof claims.azp === "string" && claims.azp !== clientId)
    throw new StrictOidcVerificationError("OIDC ID token authorized party does not match this client.");
}

async function readUserInfo(endpoint: string, accessToken: string): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await readJson(endpoint, { headers: { Authorization: `Bearer ${accessToken}` } });
  } catch (cause) {
    if (cause instanceof StrictOidcProviderUnavailableError) throw cause;
    throw new StrictOidcVerificationError("OIDC user-info response could not be verified.", { cause });
  }
  const profile = parseObject(value);
  if (!profile || typeof profile.sub !== "string" || profile.sub.length === 0)
    throw new StrictOidcVerificationError("OIDC user-info response is missing subject.");
  return profile;
}

function createProfile(profile: Record<string, unknown>, subject: string): StrictOidcProfile {
  if (profile.sub !== subject)
    throw new StrictOidcVerificationError("OIDC ID-token and user-info subjects do not match.");
  if (typeof profile.email !== "string")
    throw new StrictOidcVerificationError("OIDC user-info response is missing email.");
  const email = normalizeAccountEmail(profile.email);
  if (!isAccountEmail(email))
    throw new StrictOidcVerificationError("OIDC user-info response contains an invalid email address.");
  if (
    typeof profile.name !== "string" ||
    profile.name.trim().length === 0 ||
    unicodeCharacterCount(profile.name.trim()) > MAX_NAME_LENGTH
  )
    throw new StrictOidcVerificationError("OIDC user-info response has a missing or invalid name.");
  const result: StrictOidcProfile = {
    ...profile,
    id: subject,
    sub: subject,
    email,
    emailVerified: profile.email_verified === true,
    name: profile.name.trim(),
  };
  // Preserve the established own-property shape even when the provider picture is unusable.
  Object.defineProperty(result, "image", {
    value: parseOptionalPictureUrl(profile.picture) ?? undefined,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  return result;
}

function createUserInfoResolver(
  input: StrictOidcInput,
  state: StrictOidcState,
  readMetadata: () => Promise<StrictOidcMetadata>,
): StrictOidcClient["getUserInfo"] {
  return async (tokens: OidcTokens) => {
    if (!tokens.idToken || !tokens.accessToken)
      throw new StrictOidcVerificationError("Strict OIDC requires both an ID token and an access token.");
    const metadata = await readMetadata();
    state.jwks ??= createRemoteJWKSet(new URL(metadata.jwks_uri), {
      timeoutDuration: 10_000,
      // An unknown kid refreshes immediately for normal overlapping key rotation.
      cooldownDuration: 0,
      cacheMaxAge: 10 * 60_000,
      // Reuse bounded no-redirect fetching: a redirect would be a new trust decision.
      [customFetch]: async (url, init) => Response.json(await readJson(url.toString(), init)),
    });
    const claims = await verifyToken({ input, metadata, jwks: state.jwks, idToken: tokens.idToken });
    validateAuthorizedParty(claims, input.clientId);
    return createProfile(await readUserInfo(metadata.userinfo_endpoint, tokens.accessToken), claims.sub ?? "");
  };
}

/**
 * Strict OIDC client used by the supported generic provider path.
 * Better Auth owns state, PKCE, cookies and persistence; email is admission data, never a link key.
 */
export function createStrictOidcClient(input: {
  issuer: string;
  clientId: string;
  clientSecret?: string;
  discoveryUrl: string;
}): StrictOidcClient {
  const state: StrictOidcState = { metadataPromise: null, metadataCache: null, jwks: null };
  const metadata = createMetadataReader(input, state);
  return {
    metadata,
    exchangeCode: createCodeExchange(input, metadata),
    getUserInfo: createUserInfoResolver(input, state, metadata),
  };
}

/** Backwards-compatible resolver for callers that only need claim verification. */
export function createStrictOidcUserInfoResolver(input: {
  issuer: string;
  clientId: string;
  discoveryUrl: string;
}): (tokens: OidcTokens) => Promise<StrictOidcProfile> {
  return createStrictOidcClient(input).getUserInfo;
}
