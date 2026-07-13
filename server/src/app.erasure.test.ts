import { describe, it, expect, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app'
import { openDb, insertAll, type Db } from './db'
import { upsertMember, createInvite } from './controlTables'
import * as controlTables from './controlTables'
import { eraseAccount } from './erasure'
import { authFromEnv, countUsers, runAuthMigrations } from './auth'
import { PASSWORD_ENV, call, signUp } from './testHelpers'
import { emptyAppData, type AppData } from '@capacitylens/shared/types/entities'

// P2.6b — per-tenant DELETE + member-PII erasure. The existing 'purge'-gated account hard-delete (both
// the direct DELETE /api/accounts/:id route AND the batch accounts/DELETE op) used to drop ONLY the
// `accounts` row: the FK cascade wiped the account's scoped AppData, but `account_members` + `invites`
// LEAKED (no FK to accounts) and Better Auth's user/account/session PII was left fully intact. This
// suite proves the erasure now closes all three surfaces, AND keeps two hard invariants: it touches
// ONLY the target tenant (cross-tenant), and a member still in ANOTHER account is NOT erased.
//
// Each case asserts OBSERVABLE DB state via raw SELECT (mirroring getUsersByIds' query style) rather
// than trusting a helper — the point is to prove the bytes are gone from the actual tables.

const TS = '2026-01-01T00:00:00.000Z'
const meta = () => ({ createdAt: TS, updatedAt: TS })
const account = (id: string) => ({ id, name: `Studio ${id}`, color: '#3b82f6', ...meta() })
const client = (id: string, accountId: string) => ({ id, accountId, name: 'Acme', color: '#3b82f6', ...meta() })

/** Build an auth-on (password) app over a fresh in-memory DB, returning both so the test can seed. */
async function appWithAuth(): Promise<{ app: FastifyInstance; db: Db }> {
  const db = openDb(':memory:')
  const { mode, auth } = authFromEnv(db, PASSWORD_ENV)
  await runAuthMigrations(auth!)
  return { app: buildApp(db, { authMode: mode, auth }), db }
}

const deleteAccountRoute = (app: FastifyInstance, id: string, cookie: string) =>
  call(app, { method: 'DELETE', url: `/api/accounts/${id}`, headers: { cookie } })

const batchDeleteAccount = (app: FastifyInstance, id: string, cookie: string) =>
  call(app, {
    method: 'POST',
    url: '/api/batch',
    payload: { ops: [{ method: 'DELETE', table: 'accounts', id }] },
    headers: { cookie },
  })

// ---- Raw observable-state probes (the assertion vocabulary; never trust a helper) ----

const accountCount = (db: Db, id: string): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM accounts WHERE id = ?`).get(id) as { n: number }).n
const scopedClientCount = (db: Db, accountId: string): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM clients WHERE accountId = ?`).get(accountId) as { n: number }).n
const memberCount = (db: Db, accountId: string): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM account_members WHERE accountId = ?`).get(accountId) as { n: number }).n
const inviteCount = (db: Db, accountId: string): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM invites WHERE accountId = ?`).get(accountId) as { n: number }).n
const userRow = (db: Db, userId: string): { name: string | null; email: string | null; image: string | null } | undefined =>
  db.prepare(`SELECT name, email, image FROM user WHERE id = ?`).get(userId) as
    | { name: string | null; email: string | null; image: string | null }
    | undefined
const authAccountCount = (db: Db, userId: string): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM account WHERE userId = ?`).get(userId) as { n: number }).n
const sessionCount = (db: Db, userId: string): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM session WHERE userId = ?`).get(userId) as { n: number }).n
const verificationCount = (db: Db, userId: string): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM verification WHERE value = ?`).get(userId) as { n: number }).n
const verificationExists = (db: Db, id: string): boolean =>
  (db.prepare(`SELECT COUNT(*) AS n FROM verification WHERE id = ?`).get(id) as { n: number }).n === 1

function seedResetToken(db: Db, userId: string, id = `verification-${userId}`): void {
  db.prepare(
    `INSERT INTO verification (id, identifier, value, expiresAt, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, `reset-password:${id}`, userId, TS, TS, TS)
}

function seedAccountLinkState(db: Db, userId: string, email: string, id: string): void {
  const value = JSON.stringify({
    callbackURL: 'http://localhost:3000/settings',
    codeVerifier: `code-${id}`,
    expiresAt: Date.now() + 600_000,
    oauthState: id,
    link: { email, userId },
  })
  db.prepare(
    `INSERT INTO verification (id, identifier, value, expiresAt, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, id, value, TS, TS, TS)
}

/** Seed a control-table membership + one outstanding invite for an account (the PII surfaces with no FK). */
function seedMembershipAndInvite(db: Db, accountId: string, userId: string, role: 'owner' | 'admin'): void {
  upsertMember(db, { accountId, userId, role, status: 'active', createdAt: TS })
  createInvite(db, {
    token: `tok-${accountId}`,
    id: `inv-${accountId}`,
    accountId,
    role: 'editor',
    preauthEmail: null,
    expiresAt: '2099-01-01T00:00:00.000Z',
    usedAt: null,
    createdAt: TS,
  })
}

describe('P2.6b erasure — (a) delete cascades ONLY the target account (cross-tenant)', () => {
  it.each(['route', 'batch'] as const)('via the %s vector: a1 wiped whole, a2 wholly intact', async (vector) => {
    const { app, db } = await appWithAuth()
    insertAll(db, {
      ...emptyAppData(),
      accounts: [account('a1'), account('a2')],
      clients: [client('c1', 'a1'), client('c2', 'a2')],
    } as unknown as AppData)
    // Each account has a sole owner, a membership row and an invite (the no-FK PII surfaces).
    const u1 = await signUp(app, 'a-owner1@capacitylens.dev')
    const u2 = await signUp(app, 'a-owner2@capacitylens.dev')
    seedMembershipAndInvite(db, 'a1', u1.userId, 'owner')
    seedMembershipAndInvite(db, 'a2', u2.userId, 'owner')

    // Sanity: everything is present before the delete.
    expect(accountCount(db, 'a1')).toBe(1)
    expect(scopedClientCount(db, 'a1')).toBe(1)
    expect(memberCount(db, 'a1')).toBe(1)
    expect(inviteCount(db, 'a1')).toBe(1)

    const res = vector === 'route' ? await deleteAccountRoute(app, 'a1', u1.cookie) : await batchDeleteAccount(app, 'a1', u1.cookie)
    expect(res.statusCode).toBe(vector === 'route' ? 204 : 200)

    // a1 is GONE everywhere: account row, scoped clients, membership row, invite.
    expect(accountCount(db, 'a1')).toBe(0)
    expect(scopedClientCount(db, 'a1')).toBe(0)
    expect(memberCount(db, 'a1')).toBe(0)
    expect(inviteCount(db, 'a1')).toBe(0)

    // a2 is wholly INTACT: account row, scoped clients, membership row, invite, and its user PII.
    expect(accountCount(db, 'a2')).toBe(1)
    expect(scopedClientCount(db, 'a2')).toBe(1)
    expect(memberCount(db, 'a2')).toBe(1)
    expect(inviteCount(db, 'a2')).toBe(1)
    expect(userRow(db, u2.userId)?.email).toBe('a-owner2@capacitylens.dev')
  })
})

describe('P2.6b erasure — (b) last-company identity removal reopens password setup', () => {
  it('deletes the sole owner and every auth artifact, then allows a new first-run signup', async () => {
    const { app, db } = await appWithAuth()
    insertAll(db, { ...emptyAppData(), accounts: [account('a1')] } as unknown as AppData)
    const u = await signUp(app, 'sole-owner@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: u.userId, role: 'owner', status: 'active', createdAt: TS })
    seedResetToken(db, u.userId)
    seedAccountLinkState(db, u.userId, 'sole-owner@capacitylens.dev', 'link-sole-owner')
    seedAccountLinkState(db, 'unrelated-user', 'unrelated@capacitylens.dev', 'link-unrelated')

    // Pre-state: real identity, credential link, live session, and outstanding reset token.
    expect(userRow(db, u.userId)?.email).toBe('sole-owner@capacitylens.dev')
    expect(authAccountCount(db, u.userId)).toBeGreaterThanOrEqual(1)
    expect(sessionCount(db, u.userId)).toBeGreaterThanOrEqual(1)
    expect(verificationCount(db, u.userId)).toBe(1)
    expect(verificationExists(db, 'link-sole-owner')).toBe(true)
    expect(verificationExists(db, 'link-unrelated')).toBe(true)

    expect((await deleteAccountRoute(app, 'a1', u.cookie)).statusCode).toBe(204)

    expect(userRow(db, u.userId)).toBeUndefined()
    expect(authAccountCount(db, u.userId)).toBe(0)
    expect(sessionCount(db, u.userId)).toBe(0)
    expect(verificationCount(db, u.userId)).toBe(0)
    expect(verificationExists(db, 'link-sole-owner')).toBe(false)
    expect(verificationExists(db, 'link-unrelated')).toBe(true)
    expect(countUsers(db)).toBe(0)

    // The dead cookie now sees a genuine first-run state, and the live signup gate consults the
    // same zero-user fact per request. No restart or manual DB repair is required.
    const me = await call(app, { method: 'GET', url: '/api/auth/me', headers: { cookie: u.cookie } })
    expect(me.statusCode).toBe(401)
    expect(me.json().needsSetup).toBe(true)
    const replacement = await signUp(app, 'replacement-owner@capacitylens.dev')
    expect(userRow(db, replacement.userId)?.email).toBe('replacement-owner@capacitylens.dev')
    expect(countUsers(db)).toBe(1)
  })
})

describe('P2.6b erasure — (c) MULTI-ACCOUNT member RETAINED (the headline)', () => {
  it('M owns a1 AND is a member of a2: deleting a1 drops M\'s a1 membership but NEVER erases M', async () => {
    const { app, db } = await appWithAuth()
    insertAll(db, { ...emptyAppData(), accounts: [account('a1'), account('a2')] } as unknown as AppData)
    const m = await signUp(app, 'multi-account-member@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: m.userId, role: 'owner', status: 'active', createdAt: TS })
    upsertMember(db, { accountId: 'a2', userId: m.userId, role: 'editor', status: 'active', createdAt: TS })
    seedResetToken(db, m.userId)
    seedAccountLinkState(db, m.userId, 'multi-account-member@capacitylens.dev', 'link-multi-account')

    expect((await deleteAccountRoute(app, 'a1', m.cookie)).statusCode).toBe(204)

    // a1's membership for M is gone; a2's membership survives.
    expect(memberCount(db, 'a1')).toBe(0)
    expect(memberCount(db, 'a2')).toBe(1)
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM account_members WHERE accountId = 'a2' AND userId = ?`).get(m.userId) as { n: number }).n,
    ).toBe(1)

    // M's identity is UNCHANGED (real name + email), and the account/session rows are intact — M is
    // still an active member of a2, so the retention rule must leave them completely alone.
    const row = userRow(db, m.userId)
    expect(row!.name).toBe('Tester')
    expect(row!.email).toBe('multi-account-member@capacitylens.dev')
    expect(authAccountCount(db, m.userId)).toBeGreaterThanOrEqual(1)
    expect(sessionCount(db, m.userId)).toBeGreaterThanOrEqual(1)
    expect(verificationCount(db, m.userId)).toBe(1)
    expect(verificationExists(db, 'link-multi-account')).toBe(true)
  })
})

describe('P2.6b erasure — (d) account_members + invites for the deleted account are gone (direct count)', () => {
  it('after deleting a1, a SELECT COUNT over its account_members and invites is 0', async () => {
    const { app, db } = await appWithAuth()
    insertAll(db, { ...emptyAppData(), accounts: [account('a1')] } as unknown as AppData)
    const u = await signUp(app, 'd-owner@capacitylens.dev')
    seedMembershipAndInvite(db, 'a1', u.userId, 'owner')
    expect(memberCount(db, 'a1')).toBe(1)
    expect(inviteCount(db, 'a1')).toBe(1)

    expect((await deleteAccountRoute(app, 'a1', u.cookie)).statusCode).toBe(204)

    expect(memberCount(db, 'a1')).toBe(0)
    expect(inviteCount(db, 'a1')).toBe(0)
  })
})

describe('P2.6b erasure — (e) atomic rollback (fail-closed)', () => {
  it('a throw mid-erasure rolls the whole tx back: account, membership and user PII all survive intact', async () => {
    const { app, db } = await appWithAuth()
    insertAll(db, { ...emptyAppData(), accounts: [account('a1')], clients: [client('c1', 'a1')] } as unknown as AppData)
    const u = await signUp(app, 'rollback-owner@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: u.userId, role: 'owner', status: 'active', createdAt: TS })

    // Force a deterministic mid-tx throw: removeAllInvitesForAccount runs AFTER the account row +
    // members are deleted but BEFORE the PII scrub, so a throw here proves the EARLIER deletes roll back.
    const spy = vi
      .spyOn(controlTables, 'removeAllInvitesForAccount')
      .mockImplementationOnce(() => {
        throw new Error('forced mid-erasure failure (test)')
      })

    expect(() => eraseAccount(db, 'a1')).toThrow(/forced mid-erasure failure/)
    spy.mockRestore()

    // The tx rolled back: NOTHING changed. Account row, its scoped client, the membership, and the
    // user's real PII are ALL still present (a partial erasure must never commit).
    expect(accountCount(db, 'a1')).toBe(1)
    expect(scopedClientCount(db, 'a1')).toBe(1)
    expect(memberCount(db, 'a1')).toBe(1)
    expect(userRow(db, u.userId)?.email).toBe('rollback-owner@capacitylens.dev')
  })
})

describe('P2.6b erasure — (f) OFF mode deletes the account WITHOUT touching auth tables', () => {
  it('an OFF-mode account delete succeeds (no "no such table: user") and the AppData is gone', async () => {
    const db = openDb(':memory:') // OFF mode: no auth migrations → no user/account/session tables
    const app = buildApp(db) // authMode defaults to 'off'
    insertAll(db, {
      ...emptyAppData(),
      accounts: [account('a1')],
      clients: [client('c1', 'a1')],
    } as unknown as AppData)
    // A membership row exists even in OFF (control tables are created on every open) — proving the
    // member sweep still runs without the auth tables.
    upsertMember(db, { accountId: 'a1', userId: 'demo', role: 'owner', status: 'active', createdAt: TS })
    expect(memberCount(db, 'a1')).toBe(1)

    // The 'user' table genuinely does not exist in OFF mode.
    expect(
      db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user'`).get(),
    ).toBeUndefined()

    // OFF mode is allow-all → 204; must NOT throw "no such table: user".
    expect((await call(app, { method: 'DELETE', url: '/api/accounts/a1' })).statusCode).toBe(204)

    expect(accountCount(db, 'a1')).toBe(0)
    expect(scopedClientCount(db, 'a1')).toBe(0)
    expect(memberCount(db, 'a1')).toBe(0)
  })
})
