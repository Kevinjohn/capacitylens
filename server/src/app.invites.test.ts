import { describe, it, expect } from 'vitest'
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify'
import { buildApp } from './app'
import { openDb, insertAll, loadState, type Db } from './db'
import {
  createInvite,
  getInvite,
  upsertMember,
  normalizeEmail,
  preauthInviteAllows,
} from './controlTables'
import { resolveRole } from './membership'
import { authFromEnv, runAuthMigrations, DEMO_USER } from './auth'
import { emptyAppData, type AppData } from '@capacitylens/shared/types/entities'

// P1.9 — single-use, expiring invite links. POST /api/invites mints a token (gated 'manageInvites',
// admin+ of the target account); POST /api/invites/:token/accept binds the invited role to the
// signed-in caller's membership and consumes the token (single-use, expiry-checked). This suite
// drives sign-up -> create -> accept and asserts: the create gate (owner/admin 201, editor/viewer/
// non-member 403, session-less 401, bad/empty role 400); accept binds the membership + stamps usedAt;
// reuse 409; expired 410; unknown 404; OFF mode; and the AppData-EXCLUSION guarantee.

const TS = '2026-01-01T00:00:00.000Z'
const meta = () => ({ createdAt: TS, updatedAt: TS })

const account = (id: string) => ({ id, name: `Studio ${id}`, color: '#3b82f6', ...meta() })

const call = (app: FastifyInstance, opts: InjectOptions): Promise<LightMyRequestResponse> =>
  app.inject(opts) as unknown as Promise<LightMyRequestResponse>

/** Collapse a response's Set-Cookie header(s) into one request Cookie header. */
function cookiesOf(res: LightMyRequestResponse): string {
  const raw = res.headers['set-cookie']
  const list = Array.isArray(raw) ? raw : raw ? [raw] : []
  return list.map((c) => String(c).split(';')[0]).join('; ')
}

/** Seed one pre-existing account directly. */
function seedOne(db: Db): void {
  const d = emptyAppData() as unknown as Record<string, unknown[]>
  d.accounts = [account('a1')]
  insertAll(db, d as unknown as AppData)
}

const PASSWORD_ENV = {
  CAPACITYLENS_AUTH: 'password',
  BETTER_AUTH_SECRET: 'unit-test-secret-0123456789abcdef-0123',
  BETTER_AUTH_URL: 'http://localhost:8787',
  // P1.7: open email signup is closed by DEFAULT; these fixtures create test users via
  // sign-up/email, so re-open it explicitly (mirrors app.orgs.test.ts).
  CAPACITYLENS_ALLOW_OPEN_SIGNUP: '1',
}

/** Build an auth-on (password) app over a fresh in-memory DB. */
async function appWithAuth(): Promise<{ app: FastifyInstance; db: Db }> {
  const db = openDb(':memory:')
  const { mode, auth } = authFromEnv(db, PASSWORD_ENV)
  await runAuthMigrations(auth!)
  return { app: buildApp(db, { authMode: mode, auth }), db }
}

/** Sign up a user, returning its session cookie + the resolved user id (from /api/auth/me). */
async function signUp(app: FastifyInstance, email: string): Promise<{ cookie: string; userId: string }> {
  const res = await call(app, {
    method: 'POST',
    url: '/api/auth/sign-up/email',
    payload: { email, password: 'password-123', name: 'Tester' },
  })
  expect(res.statusCode).toBe(200)
  const cookie = cookiesOf(res)
  const me = await call(app, { method: 'GET', url: '/api/auth/me', headers: { cookie } })
  expect(me.statusCode).toBe(200)
  return { cookie, userId: me.json().user.id as string }
}

/**
 * Flip a Better Auth user's `emailVerified` flag directly in the DB (the `user` table; column is an
 * INTEGER 0/1). A fresh email+password sign-up is unverified (P1.7a), so this is how the P1.10 tests
 * obtain a VERIFIED principal: the NEXT getSession reads the live user row (Better Auth joins it
 * fresh), so normalizeSessionUser then reports emailVerified=true.
 */
function verifyUserEmail(db: Db, email: string): void {
  db.prepare(`UPDATE user SET emailVerified = 1 WHERE email = ?`).run(email)
}

const createInviteReq = (
  app: FastifyInstance,
  payload: Record<string, unknown>,
  headers: Record<string, string> = {},
) => call(app, { method: 'POST', url: '/api/invites', payload, headers })

const acceptReq = (app: FastifyInstance, token: string, headers: Record<string, string> = {}) =>
  call(app, { method: 'POST', url: `/api/invites/${token}/accept`, headers })

describe('POST /api/invites (P1.9 create) — gate', () => {
  it('owner of the account creates an invite -> 201, with a token + a getInvite row', async () => {
    const { app, db } = await appWithAuth()
    seedOne(db)
    const { cookie, userId } = await signUp(app, 'owner@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId, role: 'owner', status: 'active', createdAt: TS })

    const res = await createInviteReq(app, { accountId: 'a1', role: 'editor' }, { cookie })
    expect(res.statusCode).toBe(201)
    const body = res.json() as { token: string; accountId: string; role: string; expiresAt: string }
    expect(body.accountId).toBe('a1')
    expect(body.role).toBe('editor')
    expect(typeof body.token).toBe('string')
    expect(body.token.length).toBeGreaterThan(0)
    // The row landed in the control table, unused, with a FUTURE expiry.
    const stored = getInvite(db, body.token)!
    expect(stored.accountId).toBe('a1')
    expect(stored.role).toBe('editor')
    expect(stored.usedAt).toBeNull()
    expect(stored.preauthEmail).toBeNull() // P1.9 always null
    expect(Date.parse(stored.expiresAt)).toBeGreaterThan(Date.now())
  })

  it('admin of the account is ALLOWED (admin tier = manageInvites) -> 201', async () => {
    const { app, db } = await appWithAuth()
    seedOne(db)
    const { cookie, userId } = await signUp(app, 'admin@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId, role: 'admin', status: 'active', createdAt: TS })

    const res = await createInviteReq(app, { accountId: 'a1', role: 'viewer' }, { cookie })
    expect(res.statusCode).toBe(201)
  })

  it('editor/viewer of the account are DENIED (below admin tier) -> 403', async () => {
    for (const role of ['editor', 'viewer'] as const) {
      const { app, db } = await appWithAuth()
      seedOne(db)
      const { cookie, userId } = await signUp(app, `${role}@capacitylens.dev`)
      upsertMember(db, { accountId: 'a1', userId, role, status: 'active', createdAt: TS })

      const res = await createInviteReq(app, { accountId: 'a1', role: 'editor' }, { cookie })
      expect(res.statusCode, `${role} denied`).toBe(403)
    }
  })

  it('a non-member (cross-tenant stranger) is DENIED -> 403', async () => {
    const { app, db } = await appWithAuth()
    seedOne(db)
    const { cookie } = await signUp(app, 'stranger@capacitylens.dev') // no membership of a1

    const res = await createInviteReq(app, { accountId: 'a1', role: 'editor' }, { cookie })
    expect(res.statusCode).toBe(403)
  })

  it('a session-less request is 401 (requireUser is upstream of the invite gate)', async () => {
    const { app, db } = await appWithAuth()
    seedOne(db)
    const res = await createInviteReq(app, { accountId: 'a1', role: 'editor' })
    expect(res.statusCode).toBe(401)
  })

  it('a bad or empty role is 400 (before the gate matters for shape)', async () => {
    const { app, db } = await appWithAuth()
    seedOne(db)
    const { cookie, userId } = await signUp(app, 'badrole@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId, role: 'owner', status: 'active', createdAt: TS })

    const bad = await createInviteReq(app, { accountId: 'a1', role: 'superuser' }, { cookie })
    expect(bad.statusCode).toBe(400)
    const empty = await createInviteReq(app, { accountId: 'a1', role: '' }, { cookie })
    expect(empty.statusCode).toBe(400)
    const missingAccount = await createInviteReq(app, { role: 'editor' }, { cookie })
    expect(missingAccount.statusCode).toBe(400)
  })
})

describe('POST /api/invites/:token/accept (P1.9 accept)', () => {
  it('a signed-in user accepts a valid editor invite -> 200, role bound, token consumed', async () => {
    const { app, db } = await appWithAuth()
    seedOne(db)
    const a = await signUp(app, 'inviter@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: a.userId, role: 'owner', status: 'active', createdAt: TS })
    const created = await createInviteReq(app, { accountId: 'a1', role: 'editor' }, { cookie: a.cookie })
    const token = (created.json() as { token: string }).token

    // User B (no prior membership) accepts.
    const b = await signUp(app, 'joiner@capacitylens.dev')
    expect(resolveRole(db, { id: b.userId } as never, 'a1')).toBeNull() // not yet a member
    const res = await acceptReq(app, token, { cookie: b.cookie })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ accountId: 'a1', role: 'editor' })
    // Role bound, token stamped used.
    expect(resolveRole(db, { id: b.userId } as never, 'a1')).toBe('editor')
    expect(getInvite(db, token)!.usedAt).not.toBeNull()
  })

  it('a reused invite is 409, and neither the membership nor usedAt changes', async () => {
    const { app, db } = await appWithAuth()
    seedOne(db)
    const a = await signUp(app, 'inviter2@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: a.userId, role: 'admin', status: 'active', createdAt: TS })
    const created = await createInviteReq(app, { accountId: 'a1', role: 'viewer' }, { cookie: a.cookie })
    const token = (created.json() as { token: string }).token

    const b = await signUp(app, 'reuser@capacitylens.dev')
    expect((await acceptReq(app, token, { cookie: b.cookie })).statusCode).toBe(200)
    const usedAtAfterFirst = getInvite(db, token)!.usedAt
    expect(usedAtAfterFirst).not.toBeNull()
    expect(resolveRole(db, { id: b.userId } as never, 'a1')).toBe('viewer')

    // Second accept (same token, same user) is rejected and changes nothing.
    const second = await acceptReq(app, token, { cookie: b.cookie })
    expect(second.statusCode).toBe(409)
    expect(getInvite(db, token)!.usedAt).toBe(usedAtAfterFirst)
    expect(resolveRole(db, { id: b.userId } as never, 'a1')).toBe('viewer')
  })

  it('an expired invite is 410, and no membership is bound', async () => {
    const { app, db } = await appWithAuth()
    seedOne(db)
    const b = await signUp(app, 'late@capacitylens.dev')
    // Insert a born-expired invite directly (the body param refuses a past expiresAt, so seed it).
    createInvite(db, {
      token: 'expired-token-xyz',
      id: 'expired-invite-id',
      accountId: 'a1',
      role: 'editor',
      preauthEmail: null,
      expiresAt: '2000-01-01T00:00:00.000Z',
      usedAt: null,
      createdAt: TS,
    })

    const res = await acceptReq(app, 'expired-token-xyz', { cookie: b.cookie })
    expect(res.statusCode).toBe(410)
    expect(resolveRole(db, { id: b.userId } as never, 'a1')).toBeNull()
    expect(getInvite(db, 'expired-token-xyz')!.usedAt).toBeNull() // not consumed
  })

  it('an unknown token is 404', async () => {
    const { app, db } = await appWithAuth()
    seedOne(db)
    const b = await signUp(app, 'nobody@capacitylens.dev')
    const res = await acceptReq(app, 'no-such-token', { cookie: b.cookie })
    expect(res.statusCode).toBe(404)
  })
})

describe('invites — OFF mode (trusted-local)', () => {
  it('create + accept work and bind the DEMO_USER membership', async () => {
    const db = openDb(':memory:')
    const app = buildApp(db) // authMode defaults to 'off'
    seedOne(db)

    const created = await createInviteReq(app, { accountId: 'a1', role: 'editor' })
    expect(created.statusCode).toBe(201) // OFF = allow-all, minted as DEMO_USER's act
    const token = (created.json() as { token: string }).token

    const res = await acceptReq(app, token)
    expect(res.statusCode).toBe(200)
    expect(resolveRole(db, { id: DEMO_USER.id } as never, 'a1')).toBe('editor')
    expect(getInvite(db, token)!.usedAt).not.toBeNull()
  })
})

// P1.10 — email-pre-authorise. The pure decision matrix (preauthInviteAllows + normalizeEmail) is
// unit-tested deterministically below; the integration block then proves the create-store-normalize
// path and every accept outcome (link binds, wrong-email 403, unverified-match 403, verified-match
// 200, OFF skip) end-to-end, asserting that a 403 never consumes the single-use invite.

describe('P1.10 — preauthInviteAllows / normalizeEmail (pure decision matrix)', () => {
  it('normalizeEmail trims and lowercases', () => {
    expect(normalizeEmail('  Alice@Example.COM ')).toBe('alice@example.com')
    expect(normalizeEmail('bob@host')).toBe('bob@host')
    expect(normalizeEmail('ALREADY@LOWER.io ')).toBe('already@lower.io')
  })

  it('null preauth → true for ANY signed-in caller (link invite — even unverified)', () => {
    expect(preauthInviteAllows(null, { email: 'anyone@x.io', emailVerified: false })).toBe(true)
    expect(preauthInviteAllows(null, { email: 'anyone@x.io', emailVerified: true })).toBe(true)
  })

  it('preauth + verified + EXACT (normalized) match → true (case/whitespace folded by store-time normalize)', () => {
    // preauthEmail is stored ALREADY normalized; the user email is normalized inside the helper, so a
    // differently-cased / padded live email still matches the normalized stored value.
    const stored = normalizeEmail('Carol@Example.com') // = 'carol@example.com'
    expect(preauthInviteAllows(stored, { email: 'Carol@Example.com', emailVerified: true })).toBe(true)
    expect(preauthInviteAllows(stored, { email: '  CAROL@EXAMPLE.COM ', emailVerified: true })).toBe(
      true,
    )
  })

  it('preauth + verified + DIFFERENT email → false', () => {
    const stored = normalizeEmail('carol@example.com')
    expect(preauthInviteAllows(stored, { email: 'dave@example.com', emailVerified: true })).toBe(false)
  })

  it('preauth + UNVERIFIED + matching email → false (omitted-verification providers ⇒ unverified)', () => {
    const stored = normalizeEmail('carol@example.com')
    expect(preauthInviteAllows(stored, { email: 'carol@example.com', emailVerified: false })).toBe(
      false,
    )
  })
})

describe('POST /api/invites (P1.10 create) — preauthEmail', () => {
  it('create with preauthEmail → 201; getInvite stores the NORMALIZED value; 201 echoes it', async () => {
    const { app, db } = await appWithAuth()
    seedOne(db)
    const { cookie, userId } = await signUp(app, 'owner@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId, role: 'owner', status: 'active', createdAt: TS })

    const res = await createInviteReq(
      app,
      { accountId: 'a1', role: 'editor', preauthEmail: '  Friend@Example.COM ' },
      { cookie },
    )
    expect(res.statusCode).toBe(201)
    const body = res.json() as { token: string; preauthEmail: string }
    expect(body.preauthEmail).toBe('friend@example.com') // echoed normalized
    expect(getInvite(db, body.token)!.preauthEmail).toBe('friend@example.com') // stored normalized
  })

  it('empty/whitespace preauthEmail → stored null (link invite, unchanged P1.9 behaviour)', async () => {
    const { app, db } = await appWithAuth()
    seedOne(db)
    const { cookie, userId } = await signUp(app, 'owner2@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId, role: 'owner', status: 'active', createdAt: TS })

    const res = await createInviteReq(
      app,
      { accountId: 'a1', role: 'editor', preauthEmail: '   ' },
      { cookie },
    )
    expect(res.statusCode).toBe(201)
    const body = res.json() as { token: string; preauthEmail: string | null }
    expect(body.preauthEmail).toBeNull()
    expect(getInvite(db, body.token)!.preauthEmail).toBeNull()
  })

  it('a malformed preauthEmail → 400 (no row minted)', async () => {
    const { app, db } = await appWithAuth()
    seedOne(db)
    const { cookie, userId } = await signUp(app, 'owner3@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId, role: 'owner', status: 'active', createdAt: TS })

    for (const bad of ['not-an-email', 'two@@at.io', '@nolocal.io', 'nodomain@']) {
      const res = await createInviteReq(
        app,
        { accountId: 'a1', role: 'editor', preauthEmail: bad },
        { cookie },
      )
      expect(res.statusCode, `"${bad}" rejected`).toBe(400)
    }
  })
})

describe('POST /api/invites/:token/accept (P1.10 preauth gate)', () => {
  it('a LINK invite (preauthEmail null) still binds any signed-in caller — P1.9 regression', async () => {
    const { app, db } = await appWithAuth()
    seedOne(db)
    const a = await signUp(app, 'link-inviter@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: a.userId, role: 'owner', status: 'active', createdAt: TS })
    const created = await createInviteReq(app, { accountId: 'a1', role: 'editor' }, { cookie: a.cookie })
    const token = (created.json() as { token: string }).token

    // Joiner is an ordinary, unverified fresh sign-up — a link invite does not care.
    const b = await signUp(app, 'link-joiner@capacitylens.dev')
    const res = await acceptReq(app, token, { cookie: b.cookie })
    expect(res.statusCode).toBe(200)
    expect(resolveRole(db, { id: b.userId } as never, 'a1')).toBe('editor')
  })

  it('preauth + WRONG email → 403; membership NOT created; invite NOT consumed (usedAt stays null)', async () => {
    const { app, db } = await appWithAuth()
    seedOne(db)
    const a = await signUp(app, 'pa-inviter@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: a.userId, role: 'owner', status: 'active', createdAt: TS })
    const created = await createInviteReq(
      app,
      { accountId: 'a1', role: 'editor', preauthEmail: 'expected@capacitylens.dev' },
      { cookie: a.cookie },
    )
    const token = (created.json() as { token: string }).token

    // Wrong-email caller, even if verified, is rejected.
    const b = await signUp(app, 'wrong@capacitylens.dev')
    verifyUserEmail(db, 'wrong@capacitylens.dev')
    const res = await acceptReq(app, token, { cookie: b.cookie })
    expect(res.statusCode).toBe(403)
    expect(resolveRole(db, { id: b.userId } as never, 'a1')).toBeNull() // no bind
    expect(getInvite(db, token)!.usedAt).toBeNull() // NOT consumed — still live for the right caller
  })

  it('preauth + matching email but UNVERIFIED → 403; not consumed (fresh sign-up is unverified)', async () => {
    const { app, db } = await appWithAuth()
    seedOne(db)
    const a = await signUp(app, 'pa-inviter2@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: a.userId, role: 'owner', status: 'active', createdAt: TS })
    const created = await createInviteReq(
      app,
      { accountId: 'a1', role: 'editor', preauthEmail: 'newhire@capacitylens.dev' },
      { cookie: a.cookie },
    )
    const token = (created.json() as { token: string }).token

    // Matching email, but a fresh email+password sign-up is unverified (P1.7a) — gate denies.
    const b = await signUp(app, 'newhire@capacitylens.dev')
    const res = await acceptReq(app, token, { cookie: b.cookie })
    expect(res.statusCode).toBe(403)
    expect(resolveRole(db, { id: b.userId } as never, 'a1')).toBeNull()
    expect(getInvite(db, token)!.usedAt).toBeNull()
  })

  it('preauth + matching VERIFIED email → 200; role bound; usedAt set (end-to-end)', async () => {
    const { app, db } = await appWithAuth()
    seedOne(db)
    const a = await signUp(app, 'pa-inviter3@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: a.userId, role: 'owner', status: 'active', createdAt: TS })
    const created = await createInviteReq(
      app,
      { accountId: 'a1', role: 'editor', preauthEmail: 'verified@capacitylens.dev' },
      { cookie: a.cookie },
    )
    const token = (created.json() as { token: string }).token

    // Sign up, then flip emailVerified in the live user row; the NEXT getSession reads it fresh, so
    // the principal the accept handler sees is verified (proves the verified-match → bind path E2E).
    const b = await signUp(app, 'verified@capacitylens.dev')
    verifyUserEmail(db, 'verified@capacitylens.dev')
    // Sanity: /api/auth/me now reports the verified flag (confirms getSession reflects the row).
    const me = await call(app, { method: 'GET', url: '/api/auth/me', headers: { cookie: b.cookie } })
    expect(me.json().user.emailVerified).toBe(true)

    const res = await acceptReq(app, token, { cookie: b.cookie })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ accountId: 'a1', role: 'editor' })
    expect(resolveRole(db, { id: b.userId } as never, 'a1')).toBe('editor')
    expect(getInvite(db, token)!.usedAt).not.toBeNull()
  })

  it('OFF mode skips the preauth check — a preauth invite binds DEMO_USER (trusted-local)', async () => {
    const db = openDb(':memory:')
    const app = buildApp(db) // authMode defaults to 'off'
    seedOne(db)

    // Even a preauth invite for an unrelated email binds DEMO_USER in off (the gate is skipped).
    const created = await createInviteReq(app, {
      accountId: 'a1',
      role: 'admin',
      preauthEmail: 'someone-else@capacitylens.dev',
    })
    expect(created.statusCode).toBe(201)
    const token = (created.json() as { token: string }).token

    const res = await acceptReq(app, token)
    expect(res.statusCode).toBe(200)
    expect(resolveRole(db, { id: DEMO_USER.id } as never, 'a1')).toBe('admin')
    expect(getInvite(db, token)!.usedAt).not.toBeNull()
  })
})

describe('invites are excluded from the AppData path', () => {
  it('an invite row never appears in GET /api/state or loadState', async () => {
    const db = openDb(':memory:')
    const app = buildApp(db)
    createInvite(db, {
      token: 'secret-invite-token',
      id: 'secret-invite-id',
      accountId: 'acc-1',
      role: 'admin',
      preauthEmail: null,
      expiresAt: '2999-01-01T00:00:00.000Z',
      usedAt: null,
      createdAt: TS,
    })

    const res = await app.inject({ method: 'GET', url: '/api/state' })
    expect(res.statusCode).toBe(200)
    const state = res.json() as Record<string, unknown>
    expect(state).not.toHaveProperty('invites')
    // Belt-and-braces: the table name AND the token secret must appear NOWHERE in the wire state.
    expect(JSON.stringify(state)).not.toContain('invites')
    expect(JSON.stringify(state)).not.toContain('secret-invite-token')
    expect(loadState(db) as unknown as Record<string, unknown>).not.toHaveProperty('invites')
  })

  it('is not a known entity for generic CRUD (GET 404, POST 404 — never a listing/persist)', async () => {
    const app = buildApp(openDb(':memory:'))
    // No GET /api/:entity route exists -> Fastify 404 (never a 200 listing the invites table).
    const get = await app.inject({ method: 'GET', url: '/api/invites/some-token' })
    // NOTE: /api/invites/:token/accept is a real route; a bare GET on that shape is a 404 (no GET
    // handler), and a GET on the collection path is likewise unhandled — neither lists rows.
    expect([404, 405]).toContain(get.statusCode)
    const post = await app.inject({
      method: 'POST',
      url: '/api/account_members', // a control table proper -> generic CRUD refuses it
      payload: { accountId: 'a', userId: 'u', role: 'admin', status: 'active', createdAt: 'x' },
    })
    expect(post.statusCode).toBe(404)
  })
})
