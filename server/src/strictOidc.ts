import { createRemoteJWKSet, customFetch, jwtVerify, type JWTPayload } from 'jose'
import { authorizationCodeRequest, getOAuth2Tokens } from 'better-auth/oauth2'
import { isAccountEmail, normalizeAccountEmail } from '@capacitylens/shared/account/validation'
import { MAX_NAME_LENGTH } from '@capacitylens/shared/lib/strings'

const ACCEPTED_SIGNING_ALGORITHMS = ['RS256', 'PS256', 'ES256', 'EdDSA'] as const
const MAX_OIDC_JSON_BYTES = 1024 * 1024

/** Configuration failure in the strict OIDC relying-party profile. Kept in this module so the
 * verifier has no runtime dependency on the Better Auth composition root. */
export class StrictOidcConfigError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'StrictOidcConfigError'
  }
}

export interface StrictOidcMetadata {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
  userinfo_endpoint: string
  allowed_signing_algorithms: string[]
  token_endpoint_authentication: 'basic' | 'post'
}

interface OidcTokens {
  accessToken?: string
  idToken?: string
}

interface StrictOidcProfile extends Record<string, unknown> {
  id: string
  sub: string
  email: string
  emailVerified: boolean
  name: string
  image?: string
}

export interface StrictOidcClient {
  /** One issuer-pinned, endpoint-validated metadata view shared by redirect, exchange and claims. */
  metadata: () => Promise<StrictOidcMetadata>
  exchangeCode: (input: {
    code: string
    redirectURI: string
    codeVerifier?: string
  }) => Promise<ReturnType<typeof getOAuth2Tokens>>
  getUserInfo: (tokens: OidcTokens) => Promise<StrictOidcProfile>
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function requiredUrl(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new StrictOidcConfigError(`OIDC discovery is missing ${field}.`)
  let url: URL
  try {
    url = new URL(value)
  } catch (cause) {
    throw new StrictOidcConfigError(`OIDC discovery returned an invalid ${field}.`, { cause })
  }
  const loopback = url.hostname === 'localhost' || url.hostname.endsWith('.localhost') ||
    url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new StrictOidcConfigError(`OIDC discovery ${field} must use HTTPS outside loopback development.`)
  }
  if (url.username || url.password) throw new StrictOidcConfigError(`OIDC discovery ${field} must not contain credentials.`)
  if (url.hash) throw new StrictOidcConfigError(`OIDC discovery ${field} must not contain a fragment.`)
  return url.toString()
}

function optionalPictureUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

async function json(url: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`OIDC endpoint returned HTTP ${response.status}.`)
  const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json' && !mediaType?.endsWith('+json')) {
    throw new Error('OIDC endpoint did not return a JSON media type.')
  }
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_OIDC_JSON_BYTES) {
    throw new Error('OIDC endpoint response exceeds the accepted size limit.')
  }
  if (!response.body) throw new Error('OIDC endpoint returned an empty response.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_OIDC_JSON_BYTES) {
      await reader.cancel()
      throw new Error('OIDC endpoint response exceeds the accepted size limit.')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch (cause) {
    throw new Error('OIDC endpoint returned malformed JSON.', { cause })
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
  issuer: string
  clientId: string
  clientSecret?: string
  discoveryUrl: string
}): StrictOidcClient {
  let metadataPromise: Promise<StrictOidcMetadata> | null = null
  let jwks: ReturnType<typeof createRemoteJWKSet> | null = null

  const metadata = async (): Promise<StrictOidcMetadata> => {
    if (!metadataPromise) metadataPromise = (async () => {
      const body = object(await json(input.discoveryUrl))
      if (!body) throw new StrictOidcConfigError('OIDC discovery returned a non-object document.')
      if (body.issuer !== input.issuer) {
        throw new StrictOidcConfigError('OIDC discovery issuer does not match the configured issuer.')
      }
      const responseTypes = Array.isArray(body.response_types_supported)
        ? body.response_types_supported.filter((value): value is string => typeof value === 'string')
        : []
      if (!responseTypes.includes('code')) {
        throw new StrictOidcConfigError(
          'OIDC discovery does not advertise the authorization-code response type.',
        )
      }
      const subjectTypes = Array.isArray(body.subject_types_supported)
        ? body.subject_types_supported.filter((value): value is string => typeof value === 'string')
        : []
      if (!subjectTypes.some((value) => value === 'public' || value === 'pairwise')) {
        throw new StrictOidcConfigError(
          'OIDC discovery offers no supported public or pairwise subject type.',
        )
      }
      const algorithms = Array.isArray(body.id_token_signing_alg_values_supported)
        ? body.id_token_signing_alg_values_supported.filter((value): value is string => typeof value === 'string')
        : []
      const allowedSigningAlgorithms = algorithms.filter((algorithm) =>
        (ACCEPTED_SIGNING_ALGORITHMS as readonly string[]).includes(algorithm))
      if (allowedSigningAlgorithms.length === 0) {
        throw new StrictOidcConfigError('OIDC discovery offers no accepted asymmetric ID-token signing algorithm.')
      }
      const advertisedTokenAuthentication = Array.isArray(body.token_endpoint_auth_methods_supported)
        ? body.token_endpoint_auth_methods_supported.filter((value): value is string => typeof value === 'string')
        : null
      // OIDC Discovery specifies client_secret_basic as the default when this metadata is absent.
      // Prefer it when both common confidential-client methods are advertised; accept post for
      // providers such as development Dex configurations that explicitly select it.
      const tokenEndpointAuthentication = advertisedTokenAuthentication === null ||
        advertisedTokenAuthentication.includes('client_secret_basic')
        ? 'basic'
        : advertisedTokenAuthentication.includes('client_secret_post')
          ? 'post'
          : null
      if (!tokenEndpointAuthentication) {
        throw new StrictOidcConfigError(
          'OIDC discovery offers no supported confidential-client token endpoint authentication method.',
        )
      }
      const result: StrictOidcMetadata = {
        issuer: input.issuer,
        authorization_endpoint: requiredUrl(body.authorization_endpoint, 'authorization_endpoint'),
        token_endpoint: requiredUrl(body.token_endpoint, 'token_endpoint'),
        jwks_uri: requiredUrl(body.jwks_uri, 'jwks_uri'),
        userinfo_endpoint: requiredUrl(body.userinfo_endpoint, 'userinfo_endpoint'),
        allowed_signing_algorithms: allowedSigningAlgorithms,
        token_endpoint_authentication: tokenEndpointAuthentication,
      }
      return result
    })().catch((error) => {
      metadataPromise = null
      throw error
    })
    return metadataPromise
  }

  const exchangeCode = async (codeInput: {
    code: string
    redirectURI: string
    codeVerifier?: string
  }): Promise<ReturnType<typeof getOAuth2Tokens>> => {
    if (!input.clientSecret) {
      throw new StrictOidcConfigError('Strict OIDC code exchange requires a client secret.')
    }
    const discovered = await metadata()
    const request = await authorizationCodeRequest({
      code: codeInput.code,
      redirectURI: codeInput.redirectURI,
      codeVerifier: codeInput.codeVerifier,
      options: { clientId: input.clientId, clientSecret: input.clientSecret },
      authentication: discovered.token_endpoint_authentication,
    })
    const response = object(await json(discovered.token_endpoint, {
      method: 'POST',
      body: request.body,
      headers: request.headers as Record<string, string>,
    }))
    if (!response) throw new Error('OIDC token endpoint returned a non-object document.')
    return getOAuth2Tokens(response)
  }

  const getUserInfo = async (tokens: OidcTokens): Promise<StrictOidcProfile> => {
    if (!tokens.idToken || !tokens.accessToken) {
      throw new Error('Strict OIDC requires both an ID token and an access token.')
    }
    const discovered = await metadata()
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
    })
    const verified = await jwtVerify(tokens.idToken, jwks, {
      issuer: input.issuer,
      audience: input.clientId,
      algorithms: discovered.allowed_signing_algorithms,
      requiredClaims: ['sub', 'iat', 'exp'],
      // This token is consumed immediately after the authorization-code exchange. Constraining its
      // age turns `iat` into a real replay/freshness check rather than a presence-only checkbox.
      maxTokenAge: '10m',
      clockTolerance: 60,
    })
    const claims: JWTPayload = verified.payload
    if (claims.azp !== undefined && typeof claims.azp !== 'string') {
      throw new Error('OIDC ID token authorized party must be a string.')
    }
    if (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== input.clientId) {
      throw new Error('OIDC ID token with multiple audiences has an invalid authorized party.')
    }
    if (typeof claims.azp === 'string' && claims.azp !== input.clientId) {
      throw new Error('OIDC ID token authorized party does not match this client.')
    }
    const profile = object(await json(discovered.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    }))
    if (!profile || typeof profile.sub !== 'string' || profile.sub.length === 0) {
      throw new Error('OIDC user-info response is missing subject.')
    }
    if (profile.sub !== claims.sub) throw new Error('OIDC ID-token and user-info subjects do not match.')
    if (typeof profile.email !== 'string') {
      throw new Error('OIDC user-info response is missing email.')
    }
    const email = normalizeAccountEmail(profile.email)
    if (!isAccountEmail(email)) {
      throw new Error('OIDC user-info response contains an invalid email address.')
    }
    if (
      typeof profile.name !== 'string' ||
      profile.name.trim().length === 0 ||
      profile.name.trim().length > MAX_NAME_LENGTH
    ) {
      throw new Error('OIDC user-info response has a missing or invalid name.')
    }
    return {
      ...profile,
      id: profile.sub,
      sub: profile.sub,
      email,
      emailVerified: profile.email_verified === true,
      name: profile.name.trim(),
      image: optionalPictureUrl(profile.picture),
    }
  }

  return { metadata, exchangeCode, getUserInfo }
}

/** Backwards-compatible narrow resolver used by unit tests and embedded callers that only need
 * claim verification. The production adapter uses one shared client for all three OIDC stages. */
export function strictOidcUserInfo(input: {
  issuer: string
  clientId: string
  discoveryUrl: string
}): (tokens: OidcTokens) => Promise<StrictOidcProfile> {
  return createStrictOidcClient(input).getUserInfo
}
