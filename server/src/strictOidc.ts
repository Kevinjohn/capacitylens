import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createRemoteJWKSet, customFetch, jwtVerify, type JWTPayload } from "jose";
import { authorizationCodeRequest, getOAuth2Tokens } from "better-auth/oauth2";
import { isAccountEmail, normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import { MAX_NAME_LENGTH, unicodeCharacterCount } from "@capacitylens/shared/lib/strings";

const ACCEPTED_SIGNING_ALGORITHMS = ["RS256", "PS256", "ES256", "EdDSA"] as const;
const MAX_OIDC_JSON_BYTES = 1024 * 1024;

/** Configuration failure in the strict OIDC relying-party profile. Kept in this module so the
 * verifier has no runtime dependency on the Better Auth composition root. */
export class StrictOidcConfigError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StrictOidcConfigError";
  }
}

/** A cryptographically or semantically invalid identity response. Callers may safely normalize
 * this class to a stable authentication failure without hiding provider availability incidents. */
export class StrictOidcVerificationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StrictOidcVerificationError";
  }
}

/** A bounded provider request failed because the upstream service was unavailable. */
export class StrictOidcProviderUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StrictOidcProviderUnavailableError";
  }
}

export interface StrictOidcMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint: string;
  allowed_signing_algorithms: string[];
  token_endpoint_authentication: "basic" | "post";
}

interface OidcTokens {
  accessToken?: string;
  idToken?: string;
}

interface StrictOidcProfile extends Record<string, unknown> {
  id: string;
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  image?: string;
}

export interface StrictOidcClient {
  /** One issuer-pinned, endpoint-validated metadata view shared by redirect, exchange and claims. */
  metadata: () => Promise<StrictOidcMetadata>;
  exchangeCode: (input: {
    code: string;
    redirectURI: string;
    codeVerifier?: string;
  }) => Promise<ReturnType<typeof getOAuth2Tokens>>;
  getUserInfo: (tokens: OidcTokens) => Promise<StrictOidcProfile>;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** True for hostnames that identify the local loopback interface without a DNS lookup —
 *  localhost, its subdomains, and the IPv4/IPv6 loopback literals as `URL#hostname` renders them
 *  (bracketed for IPv6). Used to permit unencrypted HTTP only for same-machine development
 *  traffic. */
export function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1" || hostname === "[::1]"
  );
}

function requiredUrl(value: unknown, field: string): URL {
  if (typeof value !== "string") throw new StrictOidcConfigError(`OIDC discovery is missing ${field}.`);
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new StrictOidcConfigError(`OIDC discovery returned an invalid ${field}.`, { cause });
  }
  const loopback = isLoopbackHostname(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new StrictOidcConfigError(`OIDC discovery ${field} must use HTTPS outside loopback development.`);
  }
  if (url.username || url.password)
    throw new StrictOidcConfigError(`OIDC discovery ${field} must not contain credentials.`);
  if (url.hash) throw new StrictOidcConfigError(`OIDC discovery ${field} must not contain a fragment.`);
  return url;
}

/** IPv4 literals that must never be a server-side fetch destination: this-network, RFC 1918 private,
 * loopback, link-local (cloud instance metadata at 169.254.169.254), CGNAT, multicast and reserved. */
function isPrivateOrReservedIPv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true; // 224/4 multicast, 240/4 reserved, 255.255.255.255 broadcast
  return false;
}

/** Expand an IPv6 literal to its 16 octets, honouring `::` compression and a dotted-quad tail
 * (e.g. `::ffff:127.0.0.1`). Returns null for anything that is not a well-formed IPv6 address, so
 * callers fail closed. Spelling — hex vs dotted, compressed vs full — cannot change the octets, which
 * is the whole point: `::ffff:7f00:1` and `::ffff:127.0.0.1` must classify identically. */
function ipv6ToBytes(address: string): number[] | null {
  let text = address.toLowerCase();
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/); // fold a trailing IPv4 quad into two hextets
  if (dotted) {
    const quad = dotted[2].split(".").map(Number);
    if (quad.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    const hi = ((quad[0] << 8) | quad[1]).toString(16);
    const lo = ((quad[2] << 8) | quad[3]).toString(16);
    text = `${dotted[1]}${hi}:${lo}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null; // at most one `::`
  const toOctets = (part: string): number[] | null => {
    if (part === "") return [];
    const octets: number[] = [];
    for (const group of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      const value = parseInt(group, 16);
      octets.push((value >> 8) & 0xff, value & 0xff);
    }
    return octets;
  };
  const head = toOctets(halves[0]);
  const tail = halves.length === 2 ? toOctets(halves[1]) : [];
  if (head === null || tail === null) return null;
  if (halves.length === 2) {
    const fill = 16 - head.length - tail.length;
    return fill < 0 ? null : [...head, ...new Array<number>(fill).fill(0), ...tail];
  }
  return head.length === 16 ? head : null;
}

/** True when a resolved address belongs to a non-globally-routable range and so must not receive a
 * server-side OIDC fetch. Any IPv6 form that embeds an IPv4 address (mapped, compatible, 6to4, NAT64)
 * is classified by that embedded address, and anything outside global unicast (2000::/3) fails closed,
 * so a compromised IdP cannot smuggle loopback/RFC1918 past the guard by choosing an exotic spelling. */
function isPrivateOrReservedIPv6(address: string): boolean {
  const bytes = ipv6ToBytes(address);
  if (!bytes) return true; // unparseable → fail closed
  const embeddedV4 = (offset: number): boolean => isPrivateOrReservedIPv4(bytes.slice(offset, offset + 4).join("."));
  const zeroPrefix = (count: number): boolean => bytes.slice(0, count).every((octet) => octet === 0);

  if (zeroPrefix(15)) return true; // ::/120 covers unspecified (::) and loopback (::1)
  if (zeroPrefix(10) && bytes[10] === 0xff && bytes[11] === 0xff) return embeddedV4(12); // ::ffff:0:0/96 mapped
  if (zeroPrefix(12)) return embeddedV4(12); // ::/96 deprecated IPv4-compatible
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && zeroPrefix(12))
    return embeddedV4(12); // 64:ff9b::/96 NAT64
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return embeddedV4(2); // 2002::/16 6to4 embeds v4 at octets 2-5
  if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (bytes[0] === 0xff) return true; // ff00::/8 multicast
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return true; // 2001:db8::/32 docs
  return (bytes[0] & 0xe0) !== 0x20; // only global unicast 2000::/3 is routable; everything else fails closed
}

/** True when a resolved address belongs to a non-globally-routable range and so must not receive a
 * server-side OIDC fetch. Unrecognised inputs fail closed. */
function isPrivateOrReservedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateOrReservedIPv4(address);
  if (version === 6) return isPrivateOrReservedIPv6(address);
  return true; // not an IP literal → fail closed
}

/** Resolve a URL host to its literal addresses (a literal host resolves to itself), throwing a config
 * error tagged with `field` when a name cannot be resolved. */
async function resolveHostAddresses(host: string, field: string): Promise<string[]> {
  const bare = host.replace(/^\[|\]$/g, ""); // strip IPv6 brackets for classification
  if (isIP(bare)) return [bare];
  let addresses: string[];
  try {
    const records = await lookup(bare, { all: true });
    addresses = records.map((record) => record.address);
  } catch (cause) {
    throw new StrictOidcConfigError(`OIDC discovery ${field} host could not be resolved.`, { cause });
  }
  if (addresses.length === 0) throw new StrictOidcConfigError(`OIDC discovery ${field} host could not be resolved.`);
  return addresses;
}

/** True when the operator-configured issuer itself lives entirely on a private or reserved network —
 * an intentionally internal deployment, where off-origin internal endpoints are legitimate rather than
 * an SSRF pivot. A public issuer (any globally routable address) returns false so containment stays on.
 * Resolution failures fail safe: unknown means "treat as public", keeping the guard active. */
async function issuerIsInternal(issuer: URL): Promise<boolean> {
  const bare = issuer.hostname.replace(/^\[|\]$/g, "");
  try {
    if (isIP(bare)) return isPrivateOrReservedAddress(bare);
    const records = await lookup(bare, { all: true });
    return records.length > 0 && records.every((record) => isPrivateOrReservedAddress(record.address));
  } catch {
    return false;
  }
}

/**
 * Endpoints this server dereferences (token exchange, JWKS, user-info) come from the discovery
 * document, which a malicious or compromised IdP controls. The operator-configured issuer origin is
 * trusted, so a document may keep its endpoints there — the common self-hosted case, including
 * loopback development. Any *other* origin is honoured only when it resolves entirely to globally
 * routable addresses, so a compromised IdP cannot redirect a server-side fetch at loopback, cloud
 * instance metadata, or an RFC 1918 service (SSRF). Public split-origin providers keep working. The
 * browser-only `authorization_endpoint` is exempt: the user agent, not this server, dereferences it.
 *
 * Containment is skipped wholesale when the issuer itself is internal (see {@link issuerIsInternal}):
 * a deployment whose IdP is already on a private network gains nothing from blocking private endpoints,
 * and split-origin on-prem providers (issuer and endpoints on distinct internal hosts) keep working
 * with zero configuration. Because the issuer is operator-set, not attacker-controlled, a compromised
 * IdP cannot opt itself into this relaxation.
 *
 * Residual: an endpoint whose DNS answer changes between this check and the fetch (rebinding) is not
 * covered; the bar is a compromised IdP and the impact is low, so pinning the resolved IP onto the
 * connection is deliberately out of scope here.
 */
async function assertFetchableEndpoint(url: URL, field: string, issuerOrigin: string): Promise<void> {
  if (url.origin === issuerOrigin) return;
  const addresses = await resolveHostAddresses(url.hostname, field);
  if (addresses.some(isPrivateOrReservedAddress)) {
    throw new StrictOidcConfigError(
      `OIDC discovery ${field} must not resolve to a private or reserved network address off the issuer origin.`,
    );
  }
}

function optionalPictureUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

async function json(url: string, init: RequestInit = {}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (cause) {
    throw new StrictOidcProviderUnavailableError("OIDC endpoint request failed.", { cause });
  }
  const rejectBeforeRead = async (message: string): Promise<never> => {
    try {
      await response.body?.cancel();
    } catch {
      // Cleanup must not replace the bounded, operator-facing protocol error.
    }
    throw new Error(message);
  };
  if (!response.ok) {
    if (response.status === 429 || response.status >= 500) {
      try {
        await response.body?.cancel();
      } catch {
        // Cleanup must not replace the availability failure.
      }
      throw new StrictOidcProviderUnavailableError(`OIDC endpoint returned HTTP ${response.status}.`);
    }
    return rejectBeforeRead(`OIDC endpoint returned HTTP ${response.status}.`);
  }
  const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json" && !mediaType?.endsWith("+json")) {
    return rejectBeforeRead("OIDC endpoint did not return a JSON media type.");
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_OIDC_JSON_BYTES) {
    return rejectBeforeRead("OIDC endpoint response exceeds the accepted size limit.");
  }
  if (!response.body) throw new Error("OIDC endpoint returned an empty response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_OIDC_JSON_BYTES) {
      await reader.cancel();
      throw new Error("OIDC endpoint response exceeds the accepted size limit.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch (cause) {
    throw new Error("OIDC endpoint returned malformed JSON.", { cause });
  }
}

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
