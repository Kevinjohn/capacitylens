import { describe, it, expect } from 'vitest'
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify'
import { buildApp } from './app'
import { openDb, insertAll, type Db } from './db'
import { upsertMember, getMemberRole, getInvite } from './controlTables'
import { authFromEnv, runAuthMigrations } from './auth'
import { emptyAppData, type AppData } from '@capacitylens/shared/types/entities'

// P1.11 — Owner/Admin member-management endpoints. Mirrors app.invites.test.ts: drives sign-up →
// membership → the five new routes (GET/PATCH/DELETE members, GET/DELETE invites) plus the owner-grant
// guard on POST /api/invites. Asserts the gates (owner/admin allowed, editor/viewer/non-member 403,
// session-less 401), the role-change matrix (no admin→owner grant, admin can't touch an owner), the
// server-only LAST-OWNER protection (sole-owner demote/remove 403), self-target demotion, that the
// invites LIST never carries the token, cross-tenant revoke is a no-op, and — the headline — that an
// admin of one account cannot read another account's members (cross-tenant member leak → 403).

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

/** Seed two pre-existing accounts directly (a1 + a2, for the cross-tenant cases). */
function seedTwo(db: Db): void {
  const d = emptyAppData() as unknown as Record<string, unknown[]>
  d.accounts = [account('a1'), account('a2')]
  insertAll(db, d as unknown as AppData)
}

const PASSWORD_ENV = {
  CAPACITYLENS_AUTH: 'password',
  BETTER_AUTH_SECRET: 'unit-test-secret-0123456789abcdef-0123',
  BETTER_AUTH_URL: 'http://localhost:8787',
  CAPACITYLENS_ALLOW_OPEN_SIGNUP: '1',
}

async function appWithAuth(): Promise<{ app: FastifyInstance; db: Db }> {
  const db = openDb(':memory:')
  const { mode, auth } = authFromEnv(db, PASSWORD_ENV)
  await runAuthMigrations(auth!)
  return { app: buildApp(db, { authMode: mode, auth }), db }
}

/** Sign up a user, returning its session cookie + resolved user id. */
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

  it('admin cannot GRANT owner (no admin→owner escalation) → 403', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const admin = await signUp(app, 'admin-grant@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: admin.userId, role: 'admin', status: 'active', createdAt: TS })
    const target = await signUp(app, 'target-grant@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: target.userId, role: 'editor', status: 'active', createdAt: TS })

    const res = await patchRoleReq(app, 'a1', target.userId, 'owner', { cookie: admin.cookie })
    expect(res.statusCode).toBe(403)
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

  it('owner does everything — grants owner + demotes another owner → 200', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const owner = await signUp(app, 'owner-all@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: owner.userId, role: 'owner', status: 'active', createdAt: TS })
    const owner2 = await signUp(app, 'owner2-all@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: owner2.userId, role: 'owner', status: 'active', createdAt: TS })
    const ed = await signUp(app, 'ed-all@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: ed.userId, role: 'editor', status: 'active', createdAt: TS })

    expect((await patchRoleReq(app, 'a1', ed.userId, 'owner', { cookie: owner.cookie })).statusCode).toBe(200)
    // With two owners (owner + owner2 + ed-now-owner), demoting one is allowed.
    expect((await patchRoleReq(app, 'a1', owner2.userId, 'editor', { cookie: owner.cookie })).statusCode).toBe(200)
    expect(getMemberRole(db, 'a1', owner2.userId)).toBe('editor')
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

describe('LAST-OWNER protection (server-only, count-based)', () => {
  it('demoting the SOLE owner → 403; with a second owner → 200', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const owner = await signUp(app, 'sole-owner@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: owner.userId, role: 'owner', status: 'active', createdAt: TS })

    // Sole owner self-demote is blocked.
    expect((await patchRoleReq(app, 'a1', owner.userId, 'editor', { cookie: owner.cookie })).statusCode).toBe(403)
    expect(getMemberRole(db, 'a1', owner.userId)).toBe('owner')

    // Add a second owner; now the FIRST owner can step down (account keeps an owner).
    const owner2 = await signUp(app, 'second-owner@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: owner2.userId, role: 'owner', status: 'active', createdAt: TS })
    expect((await patchRoleReq(app, 'a1', owner.userId, 'editor', { cookie: owner2.cookie })).statusCode).toBe(200)
  })

  it('removing the SOLE owner → 403; with a second owner → 204', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const owner = await signUp(app, 'rm-sole@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: owner.userId, role: 'owner', status: 'active', createdAt: TS })
    expect((await removeReq(app, 'a1', owner.userId, { cookie: owner.cookie })).statusCode).toBe(403)

    const owner2 = await signUp(app, 'rm-second@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: owner2.userId, role: 'owner', status: 'active', createdAt: TS })
    expect((await removeReq(app, 'a1', owner.userId, { cookie: owner2.cookie })).statusCode).toBe(204)
    expect(getMemberRole(db, 'a1', owner.userId)).toBeNull()
  })

  it('owner self-demote is allowed when ANOTHER owner exists (self-target)', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const owner = await signUp(app, 'self-demote@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: owner.userId, role: 'owner', status: 'active', createdAt: TS })
    const owner2 = await signUp(app, 'self-demote2@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: owner2.userId, role: 'owner', status: 'active', createdAt: TS })

    const res = await patchRoleReq(app, 'a1', owner.userId, 'admin', { cookie: owner.cookie })
    expect(res.statusCode).toBe(200)
    expect(getMemberRole(db, 'a1', owner.userId)).toBe('admin')
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

describe('POST /api/invites — owner-grant guard (P1.11)', () => {
  it('admin inviting an OWNER is 403; owner inviting an owner is 201', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    const admin = await signUp(app, 'inv-owner-admin@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: admin.userId, role: 'admin', status: 'active', createdAt: TS })
    const owner = await signUp(app, 'inv-owner-owner@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId: owner.userId, role: 'owner', status: 'active', createdAt: TS })

    expect((await createInviteReq(app, { accountId: 'a1', role: 'owner' }, { cookie: admin.cookie })).statusCode).toBe(403)
    expect((await createInviteReq(app, { accountId: 'a1', role: 'owner' }, { cookie: owner.cookie })).statusCode).toBe(201)
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
  })
})
