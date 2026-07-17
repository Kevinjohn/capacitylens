import { describe, it, expect } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app'
import { openDb, insertAll, type Db } from './db'
import { upsertMember, getMemberRole, getInvite } from './controlTables'
import { authFromEnv, runAuthMigrations } from './auth'
import { PASSWORD_ENV, call, signUp } from './testHelpers'
import { emptyAppData, type AppData } from '@capacitylens/shared/types/entities'

// P1.11 — Owner/Admin member-management endpoints. Mirrors app.invites.test.ts: drives sign-up →
// membership → the five new routes (GET/PATCH/DELETE members, GET/DELETE invites) plus the Owner
// rejection on POST /api/invites. Asserts the gates (owner/admin allowed, editor/viewer/non-member 403,
// session-less 401), the role-change matrix (Owner changes only through transfer), that the
// exactly-one-Owner backstop refuses generic demotion/removal/duplication, that the
// invites LIST never carries the token, cross-tenant revoke is a no-op, and — the headline — that an
// admin of one account cannot read another account's members (cross-tenant member leak → 403).

const TS = '2026-01-01T00:00:00.000Z'
const meta = () => ({ createdAt: TS, updatedAt: TS })
const account = (id: string) => ({ id, name: `Studio ${id}`, color: '#3b82f6', ...meta() })

/** Seed two pre-existing accounts directly (a1 + a2, for the cross-tenant cases). */
function seedTwo(db: Db): void {
  const d = emptyAppData() as unknown as Record<string, unknown[]>
  d.accounts = [account('a1'), account('a2')]
  insertAll(db, d as unknown as AppData)
}

async function appWithAuth(): Promise<{ app: FastifyInstance; db: Db }> {
  const db = openDb(':memory:')
  const { mode, auth } = authFromEnv(db, PASSWORD_ENV)
  await runAuthMigrations(auth!)
  return { app: buildApp(db, { authMode: mode, auth }), db }
}

const membersReq = (app: FastifyInstance, accountId: string, headers: Record<string, string> = {}) =>
  call(app, { method: 'GET', url: `/api/accounts/${accountId}/members`, headers })

const patchRoleReq = (
  app: FastifyInstance,
  accountId: string,
  userId: string,
  role: unknown,
  headers: Record<string, string> = {},
) =>
  call(app, {
    method: 'PATCH',
    url: `/api/accounts/${accountId}/members/${userId}`,
    payload: { role },
    headers,
  })

const removeReq = (
  app: FastifyInstance,
  accountId: string,
  userId: string,
  headers: Record<string, string> = {},
) => call(app, { method: 'DELETE', url: `/api/accounts/${accountId}/members/${userId}`, headers })

const revokeSessionsReq = (
  app: FastifyInstance,
  accountId: string,
  userId: string,
  headers: Record<string, string> = {},
) => call(app, {
  method: 'POST',
  url: `/api/accounts/${accountId}/members/${userId}/revoke-sessions`,
  headers,
})

const invitesReq = (app: FastifyInstance, accountId: string, headers: Record<string, string> = {}) =>
  call(app, { method: 'GET', url: `/api/accounts/${accountId}/invites`, headers })

const createInviteReq = (
  app: FastifyInstance,
  payload: Record<string, unknown>,
  headers: Record<string, string> = {},
) => call(app, { method: 'POST', url: '/api/invites', payload, headers })

describe('GET /api/accounts/:id/members — gate', () => {
  it('owner and admin may list; editor/viewer/non-member are 403', async () => {
    for (const [role, allowed] of [
      ['owner', true],
      ['admin', true],
      ['editor', false],
      ['viewer', false],
    ] as const) {
      const { app, db } = await appWithAuth()
      seedTwo(db)
      const { cookie, userId } = await signUp(app, `${role}-list@capacitylens.dev`)
      upsertMember(db, { accountId: 'a1', userId, role, status: 'active', createdAt: TS })
      const res = await membersReq(app, 'a1', { cookie })
      expect(res.statusCode, `${role}`).toBe(allowed ? 200 : 403)
    }
  })

  it('a non-member (cross-tenant stranger) is 403', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const { cookie } = await signUp(app, 'stranger-list@capacitylens.dev')
    const res = await membersReq(app, 'a1', { cookie })
    expect(res.statusCode).toBe(403)
  })

  it('a session-less request is 401', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const res = await membersReq(app, 'a1')
    expect(res.statusCode).toBe(401)
  })

  it('THE HEADLINE — an admin of a1 cannot list a2\'s members (cross-tenant leak → 403)', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const { cookie, userId } = await signUp(app, 'a1-admin@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId, role: 'admin', status: 'active', createdAt: TS })
    // Someone unrelated is in a2; the a1-admin must not be able to read them.
    const other = await signUp(app, 'a2-owner@capacitylens.dev')
    upsertMember(db, { accountId: 'a2', userId: other.userId, role: 'owner', status: 'active', createdAt: TS })

    const res = await membersReq(app, 'a2', { cookie })
    expect(res.statusCode).toBe(403)
  })

  it('returns members with identity (name/email) + isSelf for the caller', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const owner = await signUp(app, 'owner-id@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: owner.userId, role: 'owner', status: 'active', createdAt: TS })
    const ed = await signUp(app, 'editor-id@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: ed.userId, role: 'editor', status: 'active', createdAt: TS })

    const res = await membersReq(app, 'a1', { cookie: owner.cookie })
    expect(res.statusCode).toBe(200)
    const members = (res.json() as { members: Array<{ userId: string; email: string | null; isSelf: boolean; role: string }> }).members
    expect(members).toHaveLength(2)
    const self = members.find((m) => m.userId === owner.userId)!
    expect(self.isSelf).toBe(true)
    expect(self.email).toBe('owner-id@capacitylens.dev')
    const otherRow = members.find((m) => m.userId === ed.userId)!
    expect(otherRow.isSelf).toBe(false)
    expect(otherRow.role).toBe('editor')
  })

  it('reports mayResetPassword per-row from the SERVER\'s full cross-account judgment', async () => {
    // The client hides the reset control off this field, so it must equal what the reset route would
    // decide — true for an ordinary same-account target and the caller\'s own row, false for a target
    // whose GLOBAL identity outranks the caller in another account (the cross-account takeover the
    // reset route refuses). Proving the affordance can\'t drift open past the enforcement.
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const owner = await signUp(app, 'owner-mrp@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: owner.userId, role: 'owner', status: 'active', createdAt: TS })
    // An ordinary editor, only in a1 → resettable.
    const ed = await signUp(app, 'editor-mrp@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: ed.userId, role: 'editor', status: 'active', createdAt: TS })
    // A member who is a mere editor in a1 but the OWNER of a2 → the owner of a1 has no standing in a2.
    const crossOwner = await signUp(app, 'cross-owner-mrp@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: crossOwner.userId, role: 'editor', status: 'active', createdAt: TS })
    upsertMember(db, { accountId: 'a2', userId: crossOwner.userId, role: 'owner', status: 'active', createdAt: TS })

    const res = await membersReq(app, 'a1', { cookie: owner.cookie })
    expect(res.statusCode).toBe(200)
    const members = (res.json() as {
      members: Array<{ userId: string; mayResetPassword: boolean; mayRevokeSessions: boolean }>
    }).members
    const by = (id: string) => members.find((m) => m.userId === id)!
    expect(by(ed.userId).mayResetPassword).toBe(true) // same-account editor → resettable
    expect(by(owner.userId).mayResetPassword).toBe(true) // caller's own row (self-reset exemption)
    expect(by(crossOwner.userId).mayResetPassword).toBe(false) // outranks caller in a2 → refused
    expect(by(ed.userId).mayRevokeSessions).toBe(true)
    expect(by(owner.userId).mayRevokeSessions).toBe(true)
    expect(by(crossOwner.userId).mayRevokeSessions).toBe(false)
  })
})

describe('POST /api/accounts/:id/members/:userId/revoke-sessions', () => {
  it('lets an owner terminate a member session and invalidates that cookie immediately', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const owner = await signUp(app, 'owner-revoke@capacitylens.dev')
    const target = await signUp(app, 'target-revoke@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: owner.userId, role: 'owner', status: 'active', createdAt: TS })
    upsertMember(db, { accountId: 'a1', userId: target.userId, role: 'editor', status: 'active', createdAt: TS })
    expect((await call(app, { method: 'GET', url: '/api/accounts', headers: { cookie: target.cookie } })).statusCode)
      .toBe(200)

    const revoked = await revokeSessionsReq(app, 'a1', target.userId, { cookie: owner.cookie })
    expect(revoked.statusCode).toBe(204)
    expect((await call(app, { method: 'GET', url: '/api/accounts', headers: { cookie: target.cookie } })).statusCode)
      .toBe(401)
  })

  it('refuses cross-account authority and leaves the target session intact', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const owner = await signUp(app, 'owner-revoke-cross@capacitylens.dev')
    const target = await signUp(app, 'target-revoke-cross@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: owner.userId, role: 'owner', status: 'active', createdAt: TS })
    upsertMember(db, { accountId: 'a1', userId: target.userId, role: 'editor', status: 'active', createdAt: TS })
    upsertMember(db, { accountId: 'a2', userId: target.userId, role: 'owner', status: 'active', createdAt: TS })

    expect((await revokeSessionsReq(app, 'a1', target.userId, { cookie: owner.cookie })).statusCode).toBe(403)
    expect((await call(app, { method: 'GET', url: '/api/accounts', headers: { cookie: target.cookie } })).statusCode)
      .toBe(200)
  })

  it('requires a fresh sign-in before a privileged session-termination action', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const owner = await signUp(app, 'owner-revoke-stale@capacitylens.dev')
    const target = await signUp(app, 'target-revoke-stale@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: owner.userId, role: 'owner', status: 'active', createdAt: TS })
    upsertMember(db, { accountId: 'a1', userId: target.userId, role: 'editor', status: 'active', createdAt: TS })
    db.prepare(`UPDATE session SET createdAt = ? WHERE userId = ?`)
      .run(new Date(Date.now() - 16 * 60 * 1000).toISOString(), owner.userId)

    // An old session remains usable for ordinary reads, but not the security-sensitive action.
    expect((await call(app, { method: 'GET', url: '/api/accounts', headers: { cookie: owner.cookie } })).statusCode)
      .toBe(200)
    const result = await revokeSessionsReq(app, 'a1', target.userId, { cookie: owner.cookie })
    expect(result.statusCode).toBe(403)
    expect(result.json().code).toBe('SESSION_NOT_FRESH')
    expect((await call(app, { method: 'GET', url: '/api/accounts', headers: { cookie: target.cookie } })).statusCode)
      .toBe(200)
  })
})

describe('PATCH /api/accounts/:id/members/:userId — role change', () => {
  it('admin changes editor→viewer → 200', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const admin = await signUp(app, 'admin-pr@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: admin.userId, role: 'admin', status: 'active', createdAt: TS })
    const target = await signUp(app, 'target-pr@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: target.userId, role: 'editor', status: 'active', createdAt: TS })

    const res = await patchRoleReq(app, 'a1', target.userId, 'viewer', { cookie: admin.cookie })
    expect(res.statusCode).toBe(200)
    expect(getMemberRole(db, 'a1', target.userId)).toBe('viewer')
  })

  it('Owner cannot be assigned through an ordinary role change → 400', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const admin = await signUp(app, 'admin-grant@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: admin.userId, role: 'admin', status: 'active', createdAt: TS })
    const target = await signUp(app, 'target-grant@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: target.userId, role: 'editor', status: 'active', createdAt: TS })

    const res = await patchRoleReq(app, 'a1', target.userId, 'owner', { cookie: admin.cookie })
    expect(res.statusCode).toBe(400)
    expect(getMemberRole(db, 'a1', target.userId)).toBe('editor') // unchanged
  })

  it('admin cannot demote an existing OWNER → 403', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const admin = await signUp(app, 'admin-touch@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: admin.userId, role: 'admin', status: 'active', createdAt: TS })
    const owner = await signUp(app, 'owner-touch@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: owner.userId, role: 'owner', status: 'active', createdAt: TS })

    const res = await patchRoleReq(app, 'a1', owner.userId, 'editor', { cookie: admin.cookie })
    expect(res.statusCode).toBe(403)
    expect(getMemberRole(db, 'a1', owner.userId)).toBe('owner')
  })

  it('owner manages ordinary non-owner roles but cannot grant Owner through the role endpoint', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const owner = await signUp(app, 'owner-all@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: owner.userId, role: 'owner', status: 'active', createdAt: TS })
    const ed = await signUp(app, 'ed-all@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: ed.userId, role: 'editor', status: 'active', createdAt: TS })

    expect((await patchRoleReq(app, 'a1', ed.userId, 'admin', { cookie: owner.cookie })).statusCode).toBe(200)
    expect(getMemberRole(db, 'a1', ed.userId)).toBe('admin')
    expect((await patchRoleReq(app, 'a1', ed.userId, 'owner', { cookie: owner.cookie })).statusCode).toBe(400)
    expect(getMemberRole(db, 'a1', ed.userId)).toBe('admin')
  })

  it('404 for a non-member target; 400 for a bad role', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const owner = await signUp(app, 'owner-404@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: owner.userId, role: 'owner', status: 'active', createdAt: TS })

    expect((await patchRoleReq(app, 'a1', 'ghost', 'editor', { cookie: owner.cookie })).statusCode).toBe(404)
    const ed = await signUp(app, 'ed-400@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: ed.userId, role: 'editor', status: 'active', createdAt: TS })
    expect((await patchRoleReq(app, 'a1', ed.userId, 'superuser', { cookie: owner.cookie })).statusCode).toBe(400)
  })
})

describe('exactly-one-Owner protection', () => {
  it('the Owner cannot be demoted through the generic role endpoint', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const owner = await signUp(app, 'sole-owner@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: owner.userId, role: 'owner', status: 'active', createdAt: TS })

    expect((await patchRoleReq(app, 'a1', owner.userId, 'editor', { cookie: owner.cookie })).statusCode).toBe(403)
    expect(getMemberRole(db, 'a1', owner.userId)).toBe('owner')
  })

  it('the Owner cannot be removed through the member endpoint', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const owner = await signUp(app, 'rm-sole@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: owner.userId, role: 'owner', status: 'active', createdAt: TS })
    expect((await removeReq(app, 'a1', owner.userId, { cookie: owner.cookie })).statusCode).toBe(403)
  })

  it('the database refuses a second active Owner', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const owner = await signUp(app, 'self-demote@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: owner.userId, role: 'owner', status: 'active', createdAt: TS })
    const owner2 = await signUp(app, 'second-owner-constraint@capacitylens.dev')
    expect(() => upsertMember(db, {
      accountId: 'a1', userId: owner2.userId, role: 'owner', status: 'active', createdAt: TS,
    })).toThrow(/unique/i)
    expect(getMemberRole(db, 'a1', owner.userId)).toBe('owner')
  })
})

describe('DELETE /api/accounts/:id/members/:userId — revoke gate', () => {
  it('admin cannot remove an owner → 403; admin removes an editor → 204', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const admin = await signUp(app, 'admin-rm@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: admin.userId, role: 'admin', status: 'active', createdAt: TS })
    const owner = await signUp(app, 'owner-rm@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: owner.userId, role: 'owner', status: 'active', createdAt: TS })
    const ed = await signUp(app, 'ed-rm@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: ed.userId, role: 'editor', status: 'active', createdAt: TS })

    expect((await removeReq(app, 'a1', owner.userId, { cookie: admin.cookie })).statusCode).toBe(403)
    expect((await removeReq(app, 'a1', ed.userId, { cookie: admin.cookie })).statusCode).toBe(204)
    expect(getMemberRole(db, 'a1', ed.userId)).toBeNull()
  })

  it('editor/viewer cannot remove anyone → 403', async () => {
    for (const role of ['editor', 'viewer'] as const) {
      const { app, db } = await appWithAuth()
      seedTwo(db)
      const actor = await signUp(app, `${role}-rm@capacitylens.dev`)
      upsertMember(db, { accountId: 'a1', userId: actor.userId, role, status: 'active', createdAt: TS })
      const ed = await signUp(app, `${role}-rm-target@capacitylens.dev`)
      upsertMember(db, { accountId: 'a1', userId: ed.userId, role: 'editor', status: 'active', createdAt: TS })
      expect((await removeReq(app, 'a1', ed.userId, { cookie: actor.cookie })).statusCode).toBe(403)
    }
  })
})

describe('GET /api/accounts/:id/invites — list omits the token', () => {
  it('lists invites without the bearer token; gate is manageInvites', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const owner = await signUp(app, 'inv-list-owner@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: owner.userId, role: 'owner', status: 'active', createdAt: TS })
    const created = await createInviteReq(app, { accountId: 'a1', role: 'editor' }, { cookie: owner.cookie })
    const token = (created.json() as { token: string }).token

    const res = await invitesReq(app, 'a1', { cookie: owner.cookie })
    expect(res.statusCode).toBe(200)
    // Assert the RAW body carries no token (not just the parsed objects).
    expect(res.body).not.toContain(token)
    const invites = (res.json() as { invites: Array<Record<string, unknown>> }).invites
    expect(invites).toHaveLength(1)
    expect(invites[0]).not.toHaveProperty('token')
    expect(invites[0].role).toBe('editor')
    expect(typeof invites[0].id).toBe('string')

    // editor of the account is denied (below manageInvites tier).
    const ed = await signUp(app, 'inv-list-ed@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: ed.userId, role: 'editor', status: 'active', createdAt: TS })
    expect((await invitesReq(app, 'a1', { cookie: ed.cookie })).statusCode).toBe(403)
  })
})

describe('DELETE /api/accounts/:id/invites/:inviteId — revoke', () => {
  it('owner revokes an invite (204, idempotent); cross-tenant revoke is a no-op', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const owner = await signUp(app, 'inv-rev-owner@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: owner.userId, role: 'owner', status: 'active', createdAt: TS })
    const created = await createInviteReq(app, { accountId: 'a1', role: 'editor' }, { cookie: owner.cookie })
    const token = (created.json() as { token: string }).token
    const inviteId = getInvite(db, token)!.id

    // An admin of a DIFFERENT account (a2) cannot revoke a1's invite. The gate is on a2 here
    // (cross-tenant authorize → 403), the strongest guarantee.
    const otherOwner = await signUp(app, 'a2-rev-owner@capacitylens.dev')
    upsertMember(db, { accountId: 'a2', userId: otherOwner.userId, role: 'owner', status: 'active', createdAt: TS })
    // a2 owner tries to revoke a1's invite VIA the a2 path (the accountId predicate makes it a no-op).
    expect((await call(app, {
      method: 'DELETE',
      url: `/api/accounts/a2/invites/${inviteId}`,
      headers: { cookie: otherOwner.cookie },
    })).statusCode).toBe(204) // 204 but the row is NOT deleted (wrong accountId predicate)
    expect(getInvite(db, token)).not.toBeNull() // still live

    // The real owner revokes it (204) and it's gone; a second revoke is still 204 (idempotent).
    expect((await call(app, {
      method: 'DELETE',
      url: `/api/accounts/a1/invites/${inviteId}`,
      headers: { cookie: owner.cookie },
    })).statusCode).toBe(204)
    expect(getInvite(db, token)).toBeNull()
    expect((await call(app, {
      method: 'DELETE',
      url: `/api/accounts/a1/invites/${inviteId}`,
      headers: { cookie: owner.cookie },
    })).statusCode).toBe(204)
  })
})

describe('POST /api/invites — Owner is never invitational', () => {
  it('both Admin and Owner receive 400 for an Owner invite; ordinary roles still work', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const admin = await signUp(app, 'inv-owner-admin@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: admin.userId, role: 'admin', status: 'active', createdAt: TS })
    const owner = await signUp(app, 'inv-owner-owner@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: owner.userId, role: 'owner', status: 'active', createdAt: TS })

    expect((await createInviteReq(app, { accountId: 'a1', role: 'owner' }, { cookie: admin.cookie })).statusCode).toBe(400)
    expect((await createInviteReq(app, { accountId: 'a1', role: 'owner' }, { cookie: owner.cookie })).statusCode).toBe(400)
    // An admin may still invite a non-owner role.
    expect((await createInviteReq(app, { accountId: 'a1', role: 'editor' }, { cookie: admin.cookie })).statusCode).toBe(201)
  })
})

describe('member endpoints — OFF mode (trusted-local)', () => {
  it('GET members / invites return empty; mutate routes are inert no-ops, never crash', async () => {
    const db = openDb(':memory:')
    const app = buildApp(db) // authMode defaults to 'off'
    seedTwo(db)

    expect((await membersReq(app, 'a1')).json()).toEqual({ members: [] })
    expect((await invitesReq(app, 'a1')).json()).toEqual({ invites: [] })
    // A mutate against a non-member in OFF is a 404 (no member to change) — but it must not crash.
    expect((await patchRoleReq(app, 'a1', 'ghost', 'editor')).statusCode).toBe(404)
    expect((await removeReq(app, 'a1', 'ghost')).statusCode).toBe(404)
    // A real member in OFF can be no-op'd without crashing.
    upsertMember(db, { accountId: 'a1', userId: 'demo', role: 'owner', status: 'active', createdAt: TS })
    expect((await patchRoleReq(app, 'a1', 'demo', 'admin')).statusCode).toBe(200)
    // transfer-ownership in OFF is an inert no-op success too (no real owner model; the UI is hidden in
    // OFF). Like the other OFF mutates above it returns 200 but writes NOTHING — no phantom member row is
    // minted for the target, and the caller's existing row (demo, still 'owner' — the earlier patch was
    // also inert) is left exactly as it was.
    expect((await call(app, {
      method: 'POST',
      url: '/api/accounts/a1/transfer-ownership',
      payload: { toUserId: 'somebody-else' },
    })).statusCode).toBe(200)
    expect(getMemberRole(db, 'a1', 'somebody-else')).toBeNull() // no phantom member minted
    expect(getMemberRole(db, 'a1', 'demo')).toBe('owner') // untouched — the OFF branch writes nothing
  })
})

describe('P1.11 transfer ownership — POST /api/accounts/:id/transfer-ownership (owner-only)', () => {
  const transfer = (app: FastifyInstance, accountId: string, toUserId: string, cookie?: string) =>
    call(app, {
      method: 'POST',
      url: `/api/accounts/${accountId}/transfer-ownership`,
      payload: { toUserId },
      headers: cookie ? { cookie } : {},
    })

  it('owner → existing member: target becomes owner, caller steps down to admin (atomic)', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const owner = await signUp(app, 'owner-xfer@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: owner.userId, role: 'owner', status: 'active', createdAt: TS })
    const member = await signUp(app, 'member-xfer@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: member.userId, role: 'editor', status: 'active', createdAt: TS })

    expect((await transfer(app, 'a1', member.userId, owner.cookie)).statusCode).toBe(200)
    expect(getMemberRole(db, 'a1', member.userId)).toBe('owner')
    expect(getMemberRole(db, 'a1', owner.userId)).toBe('admin')
    // createdAt is the immutable JOIN timestamp — a transfer (a role change on both rows) must NOT
    // reset it, else both users jump to the bottom of the createdAt-ordered member list and show the
    // transfer moment as their "joined" date. Both must still read the original TS. (Code-review fix.)
    const createdAtOf = (userId: string) =>
      (db.prepare('SELECT createdAt FROM account_members WHERE accountId = ? AND userId = ?').get('a1', userId) as { createdAt: string }).createdAt
    expect(createdAtOf(member.userId)).toBe(TS)
    expect(createdAtOf(owner.userId)).toBe(TS)
  })

  it('admin cannot transfer ownership → 403 (transferOwnership is owner-only, above admin)', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const admin = await signUp(app, 'admin-xfer@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: admin.userId, role: 'admin', status: 'active', createdAt: TS })
    const member = await signUp(app, 'member2-xfer@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: member.userId, role: 'editor', status: 'active', createdAt: TS })

    expect((await transfer(app, 'a1', member.userId, admin.cookie)).statusCode).toBe(403)
    expect(getMemberRole(db, 'a1', admin.userId)).toBe('admin') // unchanged
    expect(getMemberRole(db, 'a1', member.userId)).toBe('editor')
  })

  it('target must be an existing member → 404; cannot transfer to self → 400 (both leave state intact)', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const owner = await signUp(app, 'owner2-xfer@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: owner.userId, role: 'owner', status: 'active', createdAt: TS })

    expect((await transfer(app, 'a1', 'ghost-user', owner.cookie)).statusCode).toBe(404)
    expect((await transfer(app, 'a1', owner.userId, owner.cookie)).statusCode).toBe(400)
    expect(getMemberRole(db, 'a1', owner.userId)).toBe('owner') // still the owner
  })

  it('a missing or empty toUserId is a 400 (shape check, before the role/owner logic)', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const owner = await signUp(app, 'owner-guard-xfer@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: owner.userId, role: 'owner', status: 'active', createdAt: TS })

    // Absent toUserId.
    expect((await call(app, {
      method: 'POST',
      url: '/api/accounts/a1/transfer-ownership',
      payload: {},
      headers: { cookie: owner.cookie },
    })).statusCode).toBe(400)
    // Empty-string toUserId.
    expect((await transfer(app, 'a1', '', owner.cookie)).statusCode).toBe(400)
    expect(getMemberRole(db, 'a1', owner.userId)).toBe('owner') // still the owner; nothing changed
  })

  it('cross-tenant: an owner of a1 cannot transfer ownership within a2 → 403', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const a1owner = await signUp(app, 'a1owner-xfer@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: a1owner.userId, role: 'owner', status: 'active', createdAt: TS })
    const a2member = await signUp(app, 'a2member-xfer@capacitylens.dev')
    upsertMember(db, { accountId: 'a2', userId: a2member.userId, role: 'editor', status: 'active', createdAt: TS })

    expect((await transfer(app, 'a2', a2member.userId, a1owner.cookie)).statusCode).toBe(403)
    expect(getMemberRole(db, 'a2', a2member.userId)).toBe('editor') // unchanged
  })
})
