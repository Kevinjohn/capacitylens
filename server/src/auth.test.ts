import { afterEach, describe, it, expect, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { openDb } from './db'
import {
  authControlTablesNeedMigration,
  authFromEnv,
  ensureAuthControlTables,
  planAuthSchemaMigrations,
  providerIdFromExternalContext,
  runAuthMigrations,
} from './auth'
import { localExternalIdentityAdmission } from './accounts/externalIdentityAdmission'

// P1.16 — session-cookie + session-lifetime hardening, asserted by INTROSPECTING the resolved
// betterAuth options (auth.options is the exact object we passed; same robust point P1.7 uses for
// socialProviders). These are auth-ON-only: in OFF mode betterAuth is never constructed, so there
// are no options to harden — authFromEnv returns { mode:'off', auth:null } untouched.

const PASSWORD_ENV = {
  CAPACITYLENS_AUTH: 'password',
  BETTER_AUTH_SECRET: 'unit-test-secret-0123456789abcdef-0123', // 32+ chars (MIN_BETTER_AUTH_SECRET_LENGTH)
  BETTER_AUTH_URL: 'http://localhost:8787',
}

describe('startup configuration before database migration', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('can resolve auth options without application DDL, then creates controls explicitly', () => {
    const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false })
    const configured = authFromEnv(db, PASSWORD_ENV, { deferDatabaseSetup: true })
    expect(configured.auth).not.toBeNull()
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all()).toEqual([])

    ensureAuthControlTables(db, PASSWORD_ENV)
    expect(
      (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>).map(
        (row) => row.name,
      ),
    ).toEqual(['capacitylens_bootstrap_claim'])
    db.close()
  })

  it('leaves a bare database untouched when provider configuration is invalid', () => {
    const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false })
    expect(() => authFromEnv(db, { ...PASSWORD_ENV, CAPACITYLENS_GOOGLE_CLIENT_ID: 'id-without-secret' }))
      .toThrow(/google/i)
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all()).toEqual([])
    db.close()
  })

  it('refuses an OIDC issuer with query or fragment identity ambiguity', () => {
    expect(() => authFromEnv(openDb(':memory:'), {
      ...PASSWORD_ENV,
      CAPACITYLENS_SSO_CLIENT_ID: 'client',
      CAPACITYLENS_SSO_CLIENT_SECRET: 'secret',
      CAPACITYLENS_SSO_DISCOVERY_URL: 'https://idp.example/.well-known/openid-configuration',
      CAPACITYLENS_SSO_ISSUER: 'https://idp.example/tenant?version=2',
    })).toThrow(/query string or fragment/i)
  })

  it('refuses public URLs that are not a bare origin', () => {
    for (const publicUrl of [
      'https://user:pass@capacity.example',
      'https://capacity.example/deployment',
      'https://capacity.example?tenant=one',
      'https://capacity.example#fragment',
    ]) {
      expect(() => authFromEnv(openDb(':memory:'), {
        ...PASSWORD_ENV,
        BETTER_AUTH_URL: publicUrl,
      })).toThrow(/must be an origin/)
    }
  })

  it('issuer-validates discovery before the browser reaches its authorization endpoint', async () => {
    const discoveryUrl = 'https://idp.example/.well-known/openid-configuration'
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      issuer: 'https://idp.example',
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      authorization_endpoint: 'https://login.idp.example/authorize',
      token_endpoint: 'https://idp.example/token',
      jwks_uri: 'https://idp.example/keys',
      userinfo_endpoint: 'https://idp.example/userinfo',
      id_token_signing_alg_values_supported: ['RS256'],
    })))
    const { auth } = authFromEnv(openDb(':memory:'), {
      ...PASSWORD_ENV,
      CAPACITYLENS_SSO_CLIENT_ID: 'client',
      CAPACITYLENS_SSO_CLIENT_SECRET: 'secret',
      CAPACITYLENS_SSO_DISCOVERY_URL: discoveryUrl,
      CAPACITYLENS_SSO_ISSUER: 'https://idp.example',
    })
    const response = await auth!.handler(new Request(
      'http://localhost:8787/api/auth/oidc/authorize/sso?client_id=client&state=opaque&scope=openid',
    ))

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      'https://login.idp.example/authorize?client_id=client&state=opaque&scope=openid',
    )
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('fails closed before redirect when discovery does not match the pinned issuer', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      issuer: 'https://attacker.example',
      authorization_endpoint: 'https://attacker.example/authorize',
      token_endpoint: 'https://attacker.example/token',
      jwks_uri: 'https://attacker.example/keys',
      userinfo_endpoint: 'https://attacker.example/userinfo',
      id_token_signing_alg_values_supported: ['RS256'],
    })))
    const { auth } = authFromEnv(openDb(':memory:'), {
      ...PASSWORD_ENV,
      CAPACITYLENS_SSO_CLIENT_ID: 'client',
      CAPACITYLENS_SSO_CLIENT_SECRET: 'secret',
      CAPACITYLENS_SSO_DISCOVERY_URL: 'https://idp.example/.well-known/openid-configuration',
      CAPACITYLENS_SSO_ISSUER: 'https://idp.example',
    })

    const response = await auth!.handler(new Request(
      'http://localhost:8787/api/auth/oidc/authorize/sso?client_id=client&state=opaque',
    ))
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      'http://localhost:8787/?externalSignInError=1&error=provider_unavailable',
    )
    expect(response.headers.get('location')).not.toContain('attacker.example')
  })

  it('plans both app-owned auth controls and Better Auth DDL before executing either', async () => {
    const db = openDb(':memory:')
    const configured = authFromEnv(db, PASSWORD_ENV, { deferDatabaseSetup: true })
    expect(authControlTablesNeedMigration(db, PASSWORD_ENV)).toBe(true)
    const before = await planAuthSchemaMigrations(configured.auth!)
    expect(before.pending).toBe(true)
    expect(before.tables).toContain('user')

    ensureAuthControlTables(db, PASSWORD_ENV)
    await runAuthMigrations(configured.auth!)
    expect(authControlTablesNeedMigration(db, PASSWORD_ENV)).toBe(false)
    await expect(planAuthSchemaMigrations(configured.auth!)).resolves.toEqual({ pending: false, tables: [] })
    db.close()
  })
})

describe('cookie/session hardening (P1.16)', () => {
  it('pins sameSite:lax + httpOnly on the session cookie', () => {
    const { auth } = authFromEnv(openDb(':memory:'), PASSWORD_ENV)
    expect(auth!.options.advanced?.defaultCookieAttributes).toEqual({ sameSite: 'lax', httpOnly: true })
    expect(auth!.options.advanced?.cookiePrefix).toBe('capacitylens')
  })

  it('derives an insecure development cookie from an HTTP public URL', () => {
    expect(authFromEnv(openDb(':memory:'), PASSWORD_ENV).auth!.options.advanced?.useSecureCookies).toBe(false)
  })

  it('sets a valid __Host prefix and Secure from the HTTPS public URL even behind an HTTP proxy hop', () => {
    const { auth } = authFromEnv(openDb(':memory:'), {
      ...PASSWORD_ENV,
      BETTER_AUTH_URL: 'https://capacity.example',
    })
    // Better Auth's built-in switch is deliberately false because it prepends `__Secure-`.
    // CapacityLens supplies Secure directly so the stricter `__Host-` prefix remains first.
    expect(auth!.options.advanced?.useSecureCookies).toBe(false)
    expect(auth!.options.advanced?.cookiePrefix).toBe('__Host-capacitylens')
    expect(auth!.options.advanced?.defaultCookieAttributes).toEqual({
      sameSite: 'lax',
      httpOnly: true,
      secure: true,
    })
  })

  it('refuses a plaintext non-loopback public URL in production', () => {
    expect(() =>
      authFromEnv(openDb(':memory:'), {
        ...PASSWORD_ENV,
        NODE_ENV: 'production',
        BETTER_AUTH_URL: 'http://capacity.example',
      }),
    ).toThrow(/must use https:\/\//)
  })

  it('still permits loopback HTTP for a local production-container check', () => {
    expect(() =>
      authFromEnv(openDb(':memory:'), {
        ...PASSWORD_ENV,
        NODE_ENV: 'production',
        BETTER_AUTH_URL: 'http://localhost:8787',
      }),
    ).not.toThrow()
  })

  it('pins a 12-hour absolute lifetime with no sliding refresh and a 15-minute fresh window', () => {
    const { auth } = authFromEnv(openDb(':memory:'), PASSWORD_ENV)
    expect(auth!.options.session?.expiresIn).toBe(43_200)
    expect(auth!.options.session?.disableSessionRefresh).toBe(true)
    expect(auth!.options.session?.freshAge).toBe(900)
  })

  it('OFF mode constructs no betterAuth instance — nothing to harden (auth === null)', () => {
    const { mode, auth } = authFromEnv(openDb(':memory:'), { CAPACITYLENS_AUTH: 'off' })
    expect(mode).toBe('off')
    expect(auth).toBeNull()
  })
})

describe('external identity creation gate', () => {
  it('resolves the concrete provider from a parameterized database-hook route', () => {
    expect(providerIdFromExternalContext({
      path: '/oauth2/callback/:providerId',
      params: { providerId: 'sso' },
    })).toBe('sso')
    expect(providerIdFromExternalContext({ path: '/callback/google' })).toBe('google')
    expect(providerIdFromExternalContext({ path: '/oauth2/callback/:providerId' })).toBeNull()
  })

  it('disables implicit email-based account linking', () => {
    const { auth } = authFromEnv(openDb(':memory:'), PASSWORD_ENV)
    expect(auth!.options.account?.accountLinking?.disableImplicitLinking).toBe(true)
  })

  it('binds every configured external provider to a stable issuer namespace', () => {
    const db = openDb(':memory:')
    const { auth } = authFromEnv(db, {
      ...PASSWORD_ENV,
      CAPACITYLENS_GOOGLE_CLIENT_ID: 'google-client',
      CAPACITYLENS_GOOGLE_CLIENT_SECRET: 'google-secret',
    })
    expect(auth!.federatedIssuers.get('google')).toBe('https://accounts.google.com')
    expect(db.prepare(`SELECT issuer FROM account_federated_provider_bindings WHERE providerId = 'google'`).get())
      .toEqual({ issuer: 'https://accounts.google.com' })
  })

  it('stays enforced when open email registration is deliberately enabled', async () => {
    const db = openDb(':memory:')
    const { auth } = authFromEnv(db, {
      ...PASSWORD_ENV,
      CAPACITYLENS_ALLOW_OPEN_SIGNUP: '1',
      CAPACITYLENS_GOOGLE_CLIENT_ID: 'google-client',
      CAPACITYLENS_GOOGLE_CLIENT_SECRET: 'google-secret',
    }, {
      externalIdentityAdmission: async () => false,
    })
    const before = auth!.options.databaseHooks?.user?.create?.before
    expect(before).toBeTypeOf('function')

    await expect(
      before!(
        { email: 'stranger@example.com', emailVerified: true } as never,
        { path: '/callback/google' } as never,
      ),
    ).rejects.toThrow(/not invited/)
  })

  it('keeps the first-external-identity claim control when email registration is open', () => {
    const db = openDb(':memory:')
    const env = {
      ...PASSWORD_ENV,
      CAPACITYLENS_ALLOW_OPEN_SIGNUP: '1',
      CAPACITYLENS_GOOGLE_CLIENT_ID: 'google-client',
      CAPACITYLENS_GOOGLE_CLIENT_SECRET: 'google-secret',
    }
    authFromEnv(db, env)

    expect(authControlTablesNeedMigration(db, env)).toBe(false)
    expect(db.prepare(`PRAGMA table_info(capacitylens_bootstrap_claim)`).all()).not.toEqual([])
  })

  it('allows only a verified, explicitly allow-listed first identity', () => {
    const db = openDb(':memory:')
    authFromEnv(db, PASSWORD_ENV) // initializes Better Auth's user table
    const env = { CAPACITYLENS_SSO_BOOTSTRAP_EMAILS: ' owner@example.com, second@example.com ' }
    expect(localExternalIdentityAdmission({
      db,
      bootstrapEmails: env.CAPACITYLENS_SSO_BOOTSTRAP_EMAILS,
      candidate: { email: 'OWNER@example.com', emailVerified: true },
    })).toBe(true)
    expect(localExternalIdentityAdmission({
      db,
      bootstrapEmails: env.CAPACITYLENS_SSO_BOOTSTRAP_EMAILS,
      candidate: { email: 'owner@example.com', emailVerified: false },
    })).toBe(false)
    expect(localExternalIdentityAdmission({
      db,
      bootstrapEmails: env.CAPACITYLENS_SSO_BOOTSTRAP_EMAILS,
      candidate: { email: 'stranger@example.com', emailVerified: true },
    })).toBe(false)
    expect(localExternalIdentityAdmission({
      db,
      bootstrapEmails: 'not-an-email',
      candidate: { email: 'not-an-email', emailVerified: true },
    })).toBe(false)
  })

  it('allows a verified email with a live unused pre-authorised invite after bootstrap', async () => {
    const db = openDb(':memory:')
    const { auth } = authFromEnv(db, PASSWORD_ENV)
    await runAuthMigrations(auth!)
    await auth!.createCredentialUser(
      'existing-owner@example.com',
      'Existing Owner',
      'Unrelated-phrase-4827!',
      true,
    )
    db.prepare(`INSERT INTO accounts (id, name, color, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?)`)
      .run('account-1', 'Inviting workspace', '#6366f1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    db.prepare(`INSERT INTO invites
      (tokenHash, id, accountId, role, preauthEmail, expiresAt, usedAt, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`)
      .run('hash', 'invite-1', 'account-1', 'viewer', 'person@example.com', '2999-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')

    expect(localExternalIdentityAdmission({
      db,
      bootstrapEmails: undefined,
      candidate: { email: ' Person@Example.com ', emailVerified: true },
    })).toBe(true)
    expect(localExternalIdentityAdmission({
      db,
      bootstrapEmails: undefined,
      candidate: { email: 'person@example.com', emailVerified: false },
    })).toBe(false)
  })

  it('does not let an invitation replace the first-external-identity allow-list', () => {
    const db = openDb(':memory:')
    authFromEnv(db, PASSWORD_ENV)
    db.prepare(`INSERT INTO invites
      (tokenHash, id, accountId, role, preauthEmail, expiresAt, usedAt, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`)
      .run('hash', 'invite-1', 'account-1', 'viewer', 'person@example.com', '2999-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')

    expect(localExternalIdentityAdmission({
      db,
      bootstrapEmails: undefined,
      candidate: { email: 'person@example.com', emailVerified: true },
    })).toBe(false)
    expect(localExternalIdentityAdmission({
      db,
      bootstrapEmails: 'person@example.com',
      candidate: { email: 'person@example.com', emailVerified: true },
    })).toBe(true)
  })

  it('rejects expired and consumed invitations after bootstrap', async () => {
    const db = openDb(':memory:')
    const { auth } = authFromEnv(db, PASSWORD_ENV)
    await runAuthMigrations(auth!)
    await auth!.createCredentialUser(
      'existing-owner@example.com',
      'Existing Owner',
      'Unrelated-phrase-4827!',
      true,
    )
    const insert = db.prepare(`INSERT INTO invites
      (tokenHash, id, accountId, role, preauthEmail, expiresAt, usedAt, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    insert.run('expired-hash', 'expired', 'account-1', 'viewer', 'expired@example.com', '2000-01-01T00:00:00.000Z', null, '1999-01-01T00:00:00.000Z')
    insert.run('used-hash', 'used', 'account-1', 'viewer', 'used@example.com', '2999-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    expect(localExternalIdentityAdmission({
      db,
      bootstrapEmails: undefined,
      candidate: { email: 'expired@example.com', emailVerified: true },
    })).toBe(false)
    expect(localExternalIdentityAdmission({
      db,
      bootstrapEmails: undefined,
      candidate: { email: 'used@example.com', emailVerified: true },
    })).toBe(false)
  })
})
