import { describe, it, expect } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app'
import { openDb, insertAll, type Db } from './db'
import { upsertMember } from './controlTables'
import { authFromEnv, runAuthMigrations } from './auth'
import { PASSWORD_ENV, call, signUp } from './testHelpers'
import type { Role } from '@capacitylens/shared/domain/access'
import { emptyAppData, type AppData } from '@capacitylens/shared/types/entities'

// P1.18 — admin-issued password-reset links. This suite drives the whole loop end-to-end against a
// real (in-memory) Better Auth instance: mint (the admin-gated route) → redeem (Better Auth's public
// /api/auth/reset-password) → sign in with the new password. Plus the authz matrix (same
// who-may-touch-whom shape as member removal: admin must never reset an OWNER — takeover path), the
// single-use guarantee, session revocation on reset, and the mode gates (sso/off → 400, no crash).

const TS = '2026-01-01T00:00:00.000Z'
const meta = () => ({ createdAt: TS, updatedAt: TS })
const account = (id: string) => ({ id, name: `Studio ${id}`, color: '#3b82f6', ...meta() })

function seedAccount(db: Db, id: string): void {
  const d = emptyAppData() as unknown as Record<string, unknown[]>
  d.accounts = [account(id)]
  insertAll(db, d as unknown as AppData)
}

// The password every fixture signs up / signs in with — MUST match testHelpers.signUp's payload, so
// this suite's "old password still works / no longer works" assertions test the right credential.
const PASSWORD = 'password-123456'

// 'sso' mode without a real IdP: explicit endpoint URLs (no discovery fetch at build time) are
// enough for authFromEnv to construct the instance — the reset route must 400 before touching it.
const SSO_ENV = {
  CAPACITYLENS_AUTH: 'sso',
  BETTER_AUTH_SECRET: 'unit-test-secret-0123456789abcdef-0123',
  BETTER_AUTH_URL: 'http://localhost:8787',
  CAPACITYLENS_SSO_CLIENT_ID: 'client-id',
  CAPACITYLENS_SSO_CLIENT_SECRET: 'client-secret',
  CAPACITYLENS_SSO_AUTHORIZATION_URL: 'https://idp.example/authorize',
  CAPACITYLENS_SSO_TOKEN_URL: 'https://idp.example/token',
}

async function appWith(
  env: Record<string, string>,
  opts: { multiAccount?: boolean } = {},
): Promise<{ app: FastifyInstance; db: Db }> {
  const db = openDb(':memory:')
  const { mode, auth } = authFromEnv(db, env)
  await runAuthMigrations(auth!)
  return { app: buildApp(db, { authMode: mode, auth, multiAccount: opts.multiAccount }), db }
}

/** Sign-up + membership in one step: the (email, role) principal this suite's matrix drives. */
async function member(
  app: FastifyInstance,
  db: Db,
  accountId: string,
  email: string,
  role: Role,
): Promise<{ cookie: string; userId: string }> {
  const user = await signUp(app, email)
  upsertMember(db, { accountId, userId: user.userId, role, status: 'active', createdAt: TS })
  return user
}

const mint = (app: FastifyInstance, accountId: string, userId: string, cookie?: string) =>
  call(app, {
    method: 'POST',
    url: `/api/accounts/${accountId}/members/${userId}/reset-password`,
    headers: cookie ? { cookie } : {},
  })

const redeem = (app: FastifyInstance, token: string, newPassword: string) =>
  call(app, {
    method: 'POST',
    url: '/api/auth/reset-password',
    payload: { newPassword, token },
  })

const signIn = (app: FastifyInstance, email: string, password: string) =>
  call(app, { method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password } })

describe('POST /api/accounts/:accountId/members/:userId/reset-password (P1.18)', () => {
  it('owner mints a link for an editor; redeem sets the new password (old dead, new works), token is single-use', async () => {
    const { app, db } = await appWith(PASSWORD_ENV)
    seedAccount(db, 'a1')
    const owner = await member(app, db, 'a1', 'owner@capacitylens.dev', 'owner')
    const editor = await member(app, db, 'a1', 'editor@capacitylens.dev', 'editor')

    const res = await mint(app, 'a1', editor.userId, owner.cookie)
    expect(res.statusCode).toBe(201)
    const body = res.json() as { token: string; expiresAt: string }
    expect(body.token.length).toBeGreaterThan(0)
    const verificationRows = db.prepare(`SELECT identifier FROM verification`).all() as Array<{ identifier: string }>
    expect(verificationRows.length).toBeGreaterThan(0)
    expect(JSON.stringify(verificationRows)).not.toContain(body.token)
    // ~24h ahead (RESET_LINK_TTL_SECONDS) — pin "in the future, not the 1h library default's past".
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000)

    const done = await redeem(app, body.token, 'brand-new-password-456')
    expect(done.statusCode).toBe(200)

    // The OLD password is dead, the NEW one signs in.
    expect((await signIn(app, 'editor@capacitylens.dev', PASSWORD)).statusCode).toBe(401)
    expect((await signIn(app, 'editor@capacitylens.dev', 'brand-new-password-456')).statusCode).toBe(200)

    // SINGLE-USE: the token was consumed on redeem — a second redeem is refused.
    expect((await redeem(app, body.token, 'attacker-password-789')).statusCode).toBe(400)
  })

  it('revokes the target user\'s existing sessions on redeem (revokeSessionsOnPasswordReset)', async () => {
    const { app, db } = await appWith(PASSWORD_ENV)
    seedAccount(db, 'a1')
    const owner = await member(app, db, 'a1', 'owner@capacitylens.dev', 'owner')
    const editor = await member(app, db, 'a1', 'editor@capacitylens.dev', 'editor')

    // The editor's sign-up session is live before the reset…
    const before = await call(app, { method: 'GET', url: '/api/auth/me', headers: { cookie: editor.cookie } })
    expect(before.statusCode).toBe(200)

    const res = await mint(app, 'a1', editor.userId, owner.cookie)
    expect(res.statusCode).toBe(201)
    expect((await redeem(app, (res.json() as { token: string }).token, 'brand-new-password-456')).statusCode).toBe(200)

    // …and dead after: a reset means "I lost control of my credential" — old sessions must not survive.
    const after = await call(app, { method: 'GET', url: '/api/auth/me', headers: { cookie: editor.cookie } })
    expect(after.statusCode).toBe(401)
  })

  it('authz matrix: editor/viewer 403; admin→editor 201; admin→OWNER 403 (takeover path); owner→owner 201', async () => {
    const { app, db } = await appWith(PASSWORD_ENV)
    seedAccount(db, 'a1')
    const owner = await member(app, db, 'a1', 'owner@capacitylens.dev', 'owner')
    const admin = await member(app, db, 'a1', 'admin@capacitylens.dev', 'admin')
    const editor = await member(app, db, 'a1', 'editor@capacitylens.dev', 'editor')
    const viewer = await member(app, db, 'a1', 'viewer@capacitylens.dev', 'viewer')

    // Below admin tier: no reset minting at all (the authorize 'manageMembers' gate).
    expect((await mint(app, 'a1', viewer.userId, editor.cookie)).statusCode).toBe(403)
    expect((await mint(app, 'a1', editor.userId, viewer.cookie)).statusCode).toBe(403)
    // Admin may reset a non-owner…
    expect((await mint(app, 'a1', editor.userId, admin.cookie)).statusCode).toBe(201)
    // …but NEVER an owner — a reset link is an account-takeover capability (pure guard, 403).
    expect((await mint(app, 'a1', owner.userId, admin.cookie)).statusCode).toBe(403)
    // An owner may reset anyone, including an owner (self here — useful for social-only sign-ins).
    expect((await mint(app, 'a1', owner.userId, owner.cookie)).statusCode).toBe(201)
  })

  it('cross-tenant and unknown targets: non-member caller 403; non-member target 404; no session 401', async () => {
    const { app, db } = await appWith(PASSWORD_ENV)
    seedAccount(db, 'a1')
    seedAccount(db, 'a2')
    const owner1 = await member(app, db, 'a1', 'owner1@capacitylens.dev', 'owner')
    const owner2 = await member(app, db, 'a2', 'owner2@capacitylens.dev', 'owner')

    // a2's owner holds no membership in a1 → the authorize gate 403s before anything else runs.
    expect((await mint(app, 'a1', owner1.userId, owner2.cookie)).statusCode).toBe(403)
    // A userId that is not a member of a1 (owner2 targeted in a1's URL-space) → 404.
    expect((await mint(app, 'a1', owner2.userId, owner1.cookie)).statusCode).toBe(404)
    // No session at all → the requireUser preHandler 401s upstream of the route.
    expect((await mint(app, 'a1', owner1.userId)).statusCode).toBe(401)
  })

  it("mode gates: 'sso' → 400 (IdP owns credentials); 'off' → 400 (no credential model); neither crashes", async () => {
    const sso = await appWith(SSO_ENV)
    seedAccount(sso.db, 'a1')
    // No password sign-up exists in sso mode, so drive the route sessionless-permission-free is
    // impossible — but the mode gate sits AFTER authorize, which needs a session. Instead assert at
    // the OFF app (allow-all authorize) that the mode gate answers 400, and for sso assert the
    // sessionless 401 still holds (the route exists; nothing crashed at registration).
    expect((await mint(sso.app, 'a1', 'nobody')).statusCode).toBe(401)

    const off = buildApp(openDb(':memory:'))
    expect((await mint(off, 'a1', 'nobody')).statusCode).toBe(400)
  })

  it('cross-account: an admin of X cannot reset a user who is an owner of another account Y (global takeover closed)', async () => {
    const { app, db } = await appWith(PASSWORD_ENV)
    seedAccount(db, 'x')
    seedAccount(db, 'y')
    const adminX = await member(app, db, 'x', 'admin-x@capacitylens.dev', 'admin')
    // Bob is a mere editor in X but the OWNER of Y (one identity, two memberships).
    const bob = await member(app, db, 'x', 'bob@capacitylens.dev', 'editor')
    upsertMember(db, { accountId: 'y', userId: bob.userId, role: 'owner', status: 'active', createdAt: TS })

    // The per-account view says Bob is 'editor' in X, but the reset controls his GLOBAL identity —
    // which owns Y — so X's admin (with no standing in Y) is refused. The 403 body EXPLAINS why
    // (surface-not-swallow): it names the cross-account reason without leaking which account.
    const denied = await mint(app, 'x', bob.userId, adminX.cookie)
    expect(denied.statusCode).toBe(403)
    expect((denied.json() as { error: string }).error).toBe(
      'This member belongs to another account where you lack password-reset authority.',
    )

    // Even the OWNER of X is refused — an owner of X has no authority over account Y.
    const ownerX = await member(app, db, 'x', 'owner-x@capacitylens.dev', 'owner')
    expect((await mint(app, 'x', bob.userId, ownerX.cookie)).statusCode).toBe(403)
  })

  it('SELF-RESET across accounts: a user who is owner of X but a mere editor of Y may reset their OWN password', async () => {
    // The finding-1 scenario: without the isSelf exemption the cross-account loop hits Y and
    // canResetMemberPassword('editor','editor') fails the manageMembers tier, wrongly 403-ing a
    // self-reset. The acting account is X (where they are owner, so authorize passes); actor === target.
    const { app, db } = await appWith(PASSWORD_ENV, { multiAccount: true })
    seedAccount(db, 'x')
    seedAccount(db, 'y')
    const self = await member(app, db, 'x', 'self-multi@capacitylens.dev', 'owner')
    upsertMember(db, { accountId: 'y', userId: self.userId, role: 'editor', status: 'active', createdAt: TS })

    // Resetting their OWN credential succeeds (201) — self-reset needs no cross-account standing.
    const res = await mint(app, 'x', self.userId, self.cookie)
    expect(res.statusCode).toBe(201)
    // And the link redeems, proving it is a real, usable reset (not a hollow 201).
    const token = (res.json() as { token: string }).token
    expect((await redeem(app, token, 'brand-new-password-456')).statusCode).toBe(200)
  })

  // Better Auth's public /api/auth/reset-password returns a machine-readable { code } on failure, and
  // the CLIENT's messageForFailure sniffs exactly that code to pick a friendly message. Per
  // DEFENSIVE-CODING.md's test-pin rule, we PIN the library's error-body shape here so a Better Auth
  // upgrade that renamed a code would fail this suite loudly rather than silently degrade the client's
  // messaging. (These are library contracts, not our route's — hence asserted against the redeem path.)
  describe('Better Auth reset-password failure body shape (pinned for the client sniffer)', () => {
    const freshToken = async (app: FastifyInstance, db: Db): Promise<string> => {
      const owner = await member(app, db, 'a1', `owner-${Math.random()}@capacitylens.dev`, 'owner')
      const editor = await member(app, db, 'a1', `editor-${Math.random()}@capacitylens.dev`, 'editor')
      return ((await mint(app, 'a1', editor.userId, owner.cookie)).json() as { token: string }).token
    }

    it('token reuse → code INVALID_TOKEN', async () => {
      const { app, db } = await appWith(PASSWORD_ENV)
      seedAccount(db, 'a1')
      const token = await freshToken(app, db)
      expect((await redeem(app, token, 'brand-new-password-456')).statusCode).toBe(200)
      const reuse = await redeem(app, token, 'another-password-789')
      expect(reuse.statusCode).toBe(400)
      expect((reuse.json() as { code: string }).code).toBe('INVALID_TOKEN')
    })

    it('too-short password → code PASSWORD_TOO_SHORT', async () => {
      const { app, db } = await appWith(PASSWORD_ENV)
      seedAccount(db, 'a1')
      const token = await freshToken(app, db)
      const res = await redeem(app, token, 'short') // below Better Auth's 8-char minimum
      expect(res.statusCode).toBe(400)
      expect((res.json() as { code: string }).code).toBe('PASSWORD_TOO_SHORT')
    })

    it('129-char password → code PASSWORD_TOO_LONG (pins the 128 default MAX_PASSWORD_LENGTH mirrors)', async () => {
      const { app, db } = await appWith(PASSWORD_ENV)
      seedAccount(db, 'a1')
      const token = await freshToken(app, db)
      const res = await redeem(app, token, 'x'.repeat(129)) // 128 is the Better Auth default cap
      expect(res.statusCode).toBe(400)
      expect((res.json() as { code: string }).code).toBe('PASSWORD_TOO_LONG')
    })
  })

  it('TOCTOU: a reset link is burned when the target is promoted, so it cannot redeem into the new owner identity', async () => {
    const { app, db } = await appWith(PASSWORD_ENV)
    seedAccount(db, 'a1')
    const owner = await member(app, db, 'a1', 'owner@capacitylens.dev', 'owner')
    const editor = await member(app, db, 'a1', 'editor@capacitylens.dev', 'editor')

    // Admin-issued link minted while the target is an editor (allowed)…
    const res = await mint(app, 'a1', editor.userId, owner.cookie)
    expect(res.statusCode).toBe(201)
    const token = (res.json() as { token: string }).token

    // …then the owner promotes the editor to owner within the token's lifetime.
    const promote = await call(app, {
      method: 'PATCH',
      url: `/api/accounts/a1/members/${editor.userId}`,
      headers: { cookie: owner.cookie },
      payload: { role: 'admin' },
    })
    expect(promote.statusCode).toBe(200)

    // The still-held link must NOT redeem into the now-admin identity — it was revoked on promotion.
    expect((await redeem(app, token, 'attacker-owner-password')).statusCode).toBe(400)
    // The old password therefore still works (nothing was changed).
    expect((await signIn(app, 'editor@capacitylens.dev', PASSWORD)).statusCode).toBe(200)
  })

  it('the same burn happens on transfer-ownership (the promoted target\'s outstanding link dies)', async () => {
    const { app, db } = await appWith(PASSWORD_ENV)
    seedAccount(db, 'a1')
    const owner = await member(app, db, 'a1', 'owner@capacitylens.dev', 'owner')
    const editor = await member(app, db, 'a1', 'editor@capacitylens.dev', 'editor')

    const token = (
      (await mint(app, 'a1', editor.userId, owner.cookie)).json() as { token: string }
    ).token
    const transfer = await call(app, {
      method: 'POST',
      url: '/api/accounts/a1/transfer-ownership',
      headers: { cookie: owner.cookie },
      payload: { toUserId: editor.userId },
    })
    expect(transfer.statusCode).toBe(200)
    expect((await redeem(app, token, 'attacker-owner-password')).statusCode).toBe(400)
  })

  it('accepting an admin invite preserves an existing editor role and its outstanding reset link', async () => {
    const { app, db } = await appWith(PASSWORD_ENV)
    seedAccount(db, 'a1')
    const owner = await member(app, db, 'a1', 'owner@capacitylens.dev', 'owner')
    const editor = await member(app, db, 'a1', 'editor@capacitylens.dev', 'editor')

    // Admin-issued link minted while the target is an editor (allowed).
    const token = ((await mint(app, 'a1', editor.userId, owner.cookie)).json() as { token: string }).token

    // An invite is an onboarding capability, not an alternate role-management route. Accepting it
    // must consume the invite without changing the editor's existing membership.
    const inviteRes = await call(app, {
      method: 'POST',
      url: '/api/invites',
      headers: { cookie: owner.cookie },
      payload: { accountId: 'a1', role: 'admin' },
    })
    expect(inviteRes.statusCode).toBe(201)
    const inviteToken = (inviteRes.json() as { token: string }).token
    const accept = await call(app, {
      method: 'POST',
      url: `/api/invites/${inviteToken}/accept`,
      headers: { cookie: editor.cookie },
    })
    expect(accept.statusCode).toBe(200)
    expect(accept.json()).toMatchObject({ role: 'editor' })

    // No privilege change occurred, so the editor-scoped reset capability remains valid.
    expect((await redeem(app, token, 'new-editor-password')).statusCode).toBe(200)
    expect((await signIn(app, 'editor@capacitylens.dev', 'new-editor-password')).statusCode).toBe(200)
  })

  it('TOCTOU via ORG-CREATE: becoming the owner of a new account burns an outstanding reset link', async () => {
    // Multi-account instance so POST /api/orgs is not capped to one company.
    const { app, db } = await appWith(PASSWORD_ENV, { multiAccount: true })
    seedAccount(db, 'a1')
    const owner = await member(app, db, 'a1', 'owner@capacitylens.dev', 'owner')
    const adminM = await member(app, db, 'a1', 'admin@capacitylens.dev', 'admin')

    // An owner may reset an admin (mint-time guard passes: admin is only {a1: admin}).
    const token = ((await mint(app, 'a1', adminM.userId, owner.cookie)).json() as { token: string }).token

    // The admin then creates a NEW org — becoming its OWNER (upsertMember at POST /api/orgs).
    const org = await call(app, {
      method: 'POST',
      url: '/api/orgs',
      headers: { cookie: adminM.cookie },
      payload: { name: 'Second Studio' },
    })
    expect(org.statusCode).toBe(201)

    // The link minted while they were only an admin must be dead — it can't take over the new owner
    // identity (which the mint-time cross-account guard would now refuse).
    expect((await redeem(app, token, 'attacker-owner-password')).statusCode).toBe(400)
  })

  it('the public /api/auth/request-password-reset endpoint is SHADOWED (404) — no unauthenticated reset path', async () => {
    const { app, db } = await appWith(PASSWORD_ENV)
    seedAccount(db, 'a1')
    await member(app, db, 'a1', 'someone@capacitylens.dev', 'editor')

    // Configuring sendResetPassword would otherwise expose Better Auth's public request endpoint; we
    // shadow it with a 404 so there is no unauthenticated, rate-limit-off-by-default token-minting
    // (DB-growth DoS) surface. A real and an unknown email alike get 404, and nothing is minted.
    for (const email of ['someone@capacitylens.dev', 'nobody@capacitylens.dev']) {
      const res = await call(app, {
        method: 'POST',
        url: '/api/auth/request-password-reset',
        payload: { email },
      })
      expect(res.statusCode).toBe(404)
      expect(res.body).not.toMatch(/token/i)
    }
  })
})
