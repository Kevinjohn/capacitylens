import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { createStrictOidcClient, strictOidcUserInfo } from './strictOidc'

const issuer = 'http://127.0.0.1:5556/dex'
const discoveryUrl = `${issuer}/.well-known/openid-configuration`
const clientId = 'capacitylens-test'
const jwksUrl = `${issuer}/keys`
const userInfoUrl = `${issuer}/userinfo`
const requiredDiscoveryCapabilities = {
  response_types_supported: ['code'],
  subject_types_supported: ['public'],
} as const

interface SigningKey {
  kid: string
  privateKey: Parameters<SignJWT['sign']>[0]
  publicJwk: Record<string, unknown>
}

async function signingKey(kid: string): Promise<SigningKey> {
  const pair = await generateKeyPair('RS256')
  return {
    kid,
    privateKey: pair.privateKey,
    publicJwk: { ...(await exportJWK(pair.publicKey)), kid, use: 'sig', alg: 'RS256' },
  }
}

async function idToken(
  key: SigningKey,
  overrides: {
    issuer?: string
    audience?: string | string[]
    subject?: string
    azp?: unknown
    issuedAt?: number
    expiration?: number
  } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({
    email: 'owner@example.com',
    email_verified: true,
    ...(overrides.azp === undefined ? {} : { azp: overrides.azp }),
  })
    .setProtectedHeader({ alg: 'RS256', kid: key.kid, typ: 'JWT' })
    .setIssuer(overrides.issuer ?? issuer)
    .setAudience(overrides.audience ?? clientId)
    .setSubject(overrides.subject ?? 'subject-1')
    .setIssuedAt(overrides.issuedAt ?? now)
    .setExpirationTime(overrides.expiration ?? now + 300)
    .sign(key.privateKey)
}

describe('strictOidcUserInfo', () => {
  let currentKeys: SigningKey[]
  let userInfo: Record<string, unknown>

  beforeEach(async () => {
    currentKeys = [await signingKey('key-1')]
    userInfo = {
      sub: 'subject-1',
      email: 'owner@example.com',
      email_verified: true,
      name: 'Owner',
      picture: 'https://images.example.test/owner.png',
    }
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url === discoveryUrl) {
        return Response.json({
          ...requiredDiscoveryCapabilities,
          issuer,
          authorization_endpoint: `${issuer}/auth`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: jwksUrl,
          userinfo_endpoint: userInfoUrl,
          id_token_signing_alg_values_supported: ['RS256'],
        })
      }
      if (url === jwksUrl) {
        expect(init?.redirect).toBe('error')
        expect(init?.signal).toBeInstanceOf(AbortSignal)
        return Response.json({ keys: currentKeys.map((key) => key.publicJwk) })
      }
      if (url === userInfoUrl) {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer access-token')
        return Response.json(userInfo)
      }
      return new Response(null, { status: 404 })
    }))
  })

  afterEach(() => vi.unstubAllGlobals())

  it('verifies the signed ID token and maps a subject-bound verified profile', async () => {
    const resolve = strictOidcUserInfo({ issuer, clientId, discoveryUrl })
    const profile = await resolve({
      idToken: await idToken(currentKeys[0]),
      accessToken: 'access-token',
    })

    expect(profile).toMatchObject({
      id: 'subject-1',
      sub: 'subject-1',
      email: 'owner@example.com',
      emailVerified: true,
      name: 'Owner',
      image: 'https://images.example.test/owner.png',
    })
  })

  it('defaults a missing email verification claim to false', async () => {
    delete userInfo.email_verified
    const resolve = strictOidcUserInfo({ issuer, clientId, discoveryUrl })
    const profile = await resolve({ idToken: await idToken(currentKeys[0]), accessToken: 'access-token' })
    expect(profile.emailVerified).toBe(false)
  })

  it('normalizes a valid email and rejects malformed identity attributes', async () => {
    userInfo.email = ' OWNER@Example.com '
    const resolve = strictOidcUserInfo({ issuer, clientId, discoveryUrl })
    await expect(resolve({ idToken: await idToken(currentKeys[0]), accessToken: 'access-token' }))
      .resolves.toMatchObject({ email: 'owner@example.com' })

    userInfo.email = 'not-an-email'
    await expect(resolve({ idToken: await idToken(currentKeys[0]), accessToken: 'access-token' }))
      .rejects.toThrow('invalid email')
  })

  it.each([
    ['issuer', { issuer: 'http://127.0.0.1:5556/other' }],
    ['audience', { audience: 'other-client' }],
  ])('rejects an ID token with the wrong %s', async (_label, overrides) => {
    const resolve = strictOidcUserInfo({ issuer, clientId, discoveryUrl })
    await expect(resolve({
      idToken: await idToken(currentKeys[0], overrides),
      accessToken: 'access-token',
    })).rejects.toThrow()
  })

  it('rejects an ID token signed by an untrusted key', async () => {
    const attacker = await signingKey('attacker')
    const resolve = strictOidcUserInfo({ issuer, clientId, discoveryUrl })
    await expect(resolve({
      idToken: await idToken(attacker),
      accessToken: 'access-token',
    })).rejects.toThrow()
  })

  it('rejects stale and implausibly future-issued ID tokens', async () => {
    const now = Math.floor(Date.now() / 1000)
    const resolve = strictOidcUserInfo({ issuer, clientId, discoveryUrl })
    await expect(resolve({
      idToken: await idToken(currentKeys[0], { issuedAt: now - 3600, expiration: now + 300 }),
      accessToken: 'access-token',
    })).rejects.toThrow()
    await expect(resolve({
      idToken: await idToken(currentKeys[0], { issuedAt: now + 300, expiration: now + 600 }),
      accessToken: 'access-token',
    })).rejects.toThrow()
  })

  it('drops unsafe profile image URLs and rejects an oversized display name', async () => {
    userInfo.picture = 'javascript:alert(1)'
    const resolve = strictOidcUserInfo({ issuer, clientId, discoveryUrl })
    await expect(resolve({ idToken: await idToken(currentKeys[0]), accessToken: 'access-token' }))
      .resolves.toMatchObject({ image: undefined })
    userInfo.name = 'x'.repeat(10_000)
    await expect(resolve({ idToken: await idToken(currentKeys[0]), accessToken: 'access-token' }))
      .rejects.toThrow('missing or invalid name')
  })

  it('rejects a user-info response for a different subject', async () => {
    userInfo.sub = 'subject-2'
    const resolve = strictOidcUserInfo({ issuer, clientId, discoveryUrl })
    await expect(resolve({
      idToken: await idToken(currentKeys[0]),
      accessToken: 'access-token',
    })).rejects.toThrow('subjects do not match')
  })

  it('requires this client as authorized party for multi-audience tokens', async () => {
    const resolve = strictOidcUserInfo({ issuer, clientId, discoveryUrl })
    await expect(resolve({
      idToken: await idToken(currentKeys[0], { audience: [clientId, 'another-client'] }),
      accessToken: 'access-token',
    })).rejects.toThrow('authorized party')
    await expect(resolve({
      idToken: await idToken(currentKeys[0], {
        audience: [clientId, 'another-client'],
        azp: clientId,
      }),
      accessToken: 'access-token',
    })).resolves.toMatchObject({ id: 'subject-1' })
  })

  it('rejects a mismatched authorized party even with one valid audience', async () => {
    const resolve = strictOidcUserInfo({ issuer, clientId, discoveryUrl })
    await expect(resolve({
      idToken: await idToken(currentKeys[0], { azp: 'another-client' }),
      accessToken: 'access-token',
    })).rejects.toThrow('authorized party')
    await expect(resolve({
      idToken: await idToken(currentKeys[0], { azp: 42 }),
      accessToken: 'access-token',
    })).rejects.toThrow('must be a string')
  })

  it('refreshes JWKS immediately when the IdP rotates to an unknown key id', async () => {
    const resolve = strictOidcUserInfo({ issuer, clientId, discoveryUrl })
    await expect(resolve({
      idToken: await idToken(currentKeys[0]),
      accessToken: 'access-token',
    })).resolves.toMatchObject({ id: 'subject-1' })

    currentKeys = [await signingKey('key-2')]
    await expect(resolve({
      idToken: await idToken(currentKeys[0]),
      accessToken: 'access-token',
    })).resolves.toMatchObject({ id: 'subject-1' })
  })

  it('rejects discovery metadata that cannot support the strict signing profile', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ...requiredDiscoveryCapabilities,
      issuer,
      authorization_endpoint: `${issuer}/auth`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: jwksUrl,
      userinfo_endpoint: userInfoUrl,
      id_token_signing_alg_values_supported: ['HS256'],
    })))
    const resolve = strictOidcUserInfo({ issuer, clientId, discoveryUrl })
    await expect(resolve({
      idToken: await idToken(currentKeys[0]),
      accessToken: 'access-token',
    })).rejects.toThrow('no accepted asymmetric')
  })

  it.each([
    [
      'authorization-code response type',
      { response_types_supported: ['id_token'], subject_types_supported: ['public'] },
      'authorization-code response type',
    ],
    [
      'standard subject type',
      { response_types_supported: ['code'], subject_types_supported: ['nonstandard'] },
      'subject type',
    ],
  ])('rejects discovery without a supported %s', async (_label, capabilities, message) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      issuer,
      authorization_endpoint: `${issuer}/auth`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: jwksUrl,
      userinfo_endpoint: userInfoUrl,
      id_token_signing_alg_values_supported: ['RS256'],
      ...capabilities,
    })))
    const client = createStrictOidcClient({ issuer, clientId, discoveryUrl })
    await expect(client.metadata()).rejects.toThrow(message)
  })

  it('selects only standard confidential-client token authentication methods', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ...requiredDiscoveryCapabilities,
      issuer,
      authorization_endpoint: `${issuer}/auth`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: jwksUrl,
      userinfo_endpoint: userInfoUrl,
      id_token_signing_alg_values_supported: ['RS256'],
      token_endpoint_auth_methods_supported: ['client_secret_post'],
    })))
    const client = createStrictOidcClient({ issuer, clientId, discoveryUrl })
    await expect(client.metadata()).resolves.toMatchObject({ token_endpoint_authentication: 'post' })

    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ...requiredDiscoveryCapabilities,
      issuer,
      authorization_endpoint: `${issuer}/auth`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: jwksUrl,
      userinfo_endpoint: userInfoUrl,
      id_token_signing_alg_values_supported: ['RS256'],
      token_endpoint_auth_methods_supported: ['private_key_jwt'],
    })))
    const unsupported = createStrictOidcClient({ issuer, clientId, discoveryUrl })
    await expect(unsupported.metadata()).rejects.toThrow('no supported confidential-client')
  })

  it('exchanges the code only at the validated endpoint with bounded no-redirect fetch policy', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url === discoveryUrl) {
        return Response.json({
          ...requiredDiscoveryCapabilities,
          issuer,
          authorization_endpoint: `${issuer}/auth`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: jwksUrl,
          userinfo_endpoint: userInfoUrl,
          id_token_signing_alg_values_supported: ['RS256'],
          token_endpoint_auth_methods_supported: ['client_secret_basic'],
        })
      }
      if (url === `${issuer}/token`) {
        expect(init?.method).toBe('POST')
        expect(init?.redirect).toBe('error')
        expect(init?.signal).toBeInstanceOf(AbortSignal)
        expect(new Headers(init?.headers).get('authorization')).toMatch(/^Basic /)
        expect(init?.body).toBeInstanceOf(URLSearchParams)
        expect((init?.body as URLSearchParams).get('code_verifier')).toBe('verifier')
        return Response.json({ access_token: 'access-token', id_token: 'id-token' })
      }
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = createStrictOidcClient({
      issuer,
      clientId,
      clientSecret: 'client-secret',
      discoveryUrl,
    })

    await expect(client.exchangeCode({
      code: 'authorization-code',
      redirectURI: 'https://app.example.test/api/auth/oauth2/callback/sso',
      codeVerifier: 'verifier',
    })).resolves.toMatchObject({ accessToken: 'access-token', idToken: 'id-token' })
  })

  it('rejects oversized provider JSON before parsing it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', {
      headers: {
        'content-type': 'application/json',
        'content-length': String(1024 * 1024 + 1),
      },
    })))
    const client = createStrictOidcClient({ issuer, clientId, discoveryUrl })
    await expect(client.metadata()).rejects.toThrow('size limit')
  })

  it('rejects unsafe discovered endpoints before redirect or token exchange can use them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ...requiredDiscoveryCapabilities,
      issuer,
      authorization_endpoint: 'http://idp.example.test/authorize',
      token_endpoint: `${issuer}/token`,
      jwks_uri: jwksUrl,
      userinfo_endpoint: userInfoUrl,
      id_token_signing_alg_values_supported: ['RS256'],
    })))
    const client = createStrictOidcClient({ issuer, clientId, discoveryUrl })
    await expect(client.metadata()).rejects.toThrow('authorization_endpoint must use HTTPS')
  })

  it('rejects discovered endpoint fragments rather than silently dropping them on HTTP use', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ...requiredDiscoveryCapabilities,
      issuer,
      authorization_endpoint: `${issuer}/auth#unexpected`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: jwksUrl,
      userinfo_endpoint: userInfoUrl,
      id_token_signing_alg_values_supported: ['RS256'],
    })))
    const client = createStrictOidcClient({ issuer, clientId, discoveryUrl })
    await expect(client.metadata()).rejects.toThrow('must not contain a fragment')
  })

  it('fails closed when discovery is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })))
    const resolve = strictOidcUserInfo({ issuer, clientId, discoveryUrl })
    await expect(resolve({
      idToken: await idToken(currentKeys[0]),
      accessToken: 'access-token',
    })).rejects.toThrow('HTTP 503')
  })

  it('retries discovery after a transient failure instead of caching rejection forever', async () => {
    const healthyFetch = globalThis.fetch
    let discoveryAttempts = 0
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url === discoveryUrl && discoveryAttempts++ === 0) {
        return new Response(null, { status: 503 })
      }
      return healthyFetch(input, init)
    }))
    const resolve = strictOidcUserInfo({ issuer, clientId, discoveryUrl })
    const tokens = { idToken: await idToken(currentKeys[0]), accessToken: 'access-token' }

    await expect(resolve(tokens)).rejects.toThrow('HTTP 503')
    await expect(resolve(tokens)).resolves.toMatchObject({ id: 'subject-1' })
    expect(discoveryAttempts).toBe(2)
  })
})
