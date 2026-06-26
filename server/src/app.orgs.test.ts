import { describe, it, expect } from 'vitest'
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify'
import { buildApp } from './app'
import { openDb, insertAll, loadState, type Db } from './db'
import { upsertMember } from './controlTables'
import { resolveRole } from './membership'
import { authFromEnv, runAuthMigrations, DEMO_USER } from './auth'
import { emptyAppData, type AppData } from '@capacitylens/shared/types/entities'

// P1.8 — constrained org-creation (POST /api/orgs). The endpoint allows iff ANY of: zero accounts
// (first-run bootstrap), OFF mode (trusted-local), the caller is an ACTIVE owner/admin of SOME
// existing account, or a matching x-capacitylens-bootstrap-token header (env, off by default);
// otherwise 403. On success it creates the account + its built-in Internal client + an Owner
// membership for the caller, ATOMICALLY (tx). This suite drives sign-up -> POST /api/orgs and asserts
// the resulting status AND the three created artifacts (account row, Internal client, Owner role).

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

/** Seed one pre-existing account directly (so "an account already exists" holds). */
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
  // sign-up/email, so re-open it explicitly until the invite flow (P1.9/P1.10) exists.
  CAPACITYLENS_ALLOW_OPEN_SIGNUP: '1',
}

/** Build an auth-on (password) app over a fresh in-memory DB. `bootstrapToken` is optional. */
async function appWithAuth(bootstrapToken?: string): Promise<{ app: FastifyInstance; db: Db }> {
  const db = openDb(':memory:')
  const { mode, auth } = authFromEnv(db, PASSWORD_ENV)
  await runAuthMigrations(auth!)
  return { app: buildApp(db, { authMode: mode, auth, bootstrapToken }), db }
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

const createOrg = (
  app: FastifyInstance,
  payload: Record<string, unknown>,
  headers: Record<string, string> = {},
) => call(app, { method: 'POST', url: '/api/orgs', payload, headers })

/** Assert the org `accountId` was created with a built-in Internal client and `userId` as Owner. */
function assertUsableOrg(db: Db, accountId: string, userId: string): void {
  const state = loadState(db)
  const acc = state.accounts.find((a) => a.id === accountId)
  expect(acc, 'account row exists').toBeDefined()
  const internal = state.clients.filter((c) => c.accountId === accountId && c.builtin === true)
  expect(internal, 'exactly one built-in Internal client').toHaveLength(1)
  expect(resolveRole(db, { id: userId } as never, accountId)).toBe('owner')
}

describe('POST /api/orgs (P1.8) — auth-on', () => {
  it('zero-account bootstrap: a signed-up user creates the first org; a now-Owner can create a second', async () => {
    const { app, db } = await appWithAuth()
    expect(loadState(db).accounts).toHaveLength(0) // first-run: no accounts
    const { cookie, userId } = await signUp(app, 'founder@capacitylens.dev')

    const first = await createOrg(app, { name: 'First Studio' }, { cookie })
    expect(first.statusCode).toBe(201)
    const id1 = first.json().id as string
    assertUsableOrg(db, id1, userId) // account + Internal + Owner, atomically

    // Now an Owner of an existing account, the SAME user creates a second org (owner-of-existing path),
    // even though accounts no longer number zero.
    const second = await createOrg(app, { name: 'Second Studio' }, { cookie })
    expect(second.statusCode).toBe(201)
    assertUsableOrg(db, second.json().id as string, userId)
  })

  it('existing-account stranger DENIED: no owner/admin membership -> 403 and the account is NOT created', async () => {
    const { app, db } = await appWithAuth()
    seedOne(db) // an account already exists
    const { cookie } = await signUp(app, 'stranger@capacitylens.dev') // holds NO membership

    const res = await createOrg(app, { name: 'Sneaky Studio' }, { cookie })
    expect(res.statusCode).toBe(403)
    expect(loadState(db).accounts.map((a) => a.id)).toEqual(['a1']) // nothing created
  })

  it('owner of an existing account is ALLOWED to create another (and becomes its Owner)', async () => {
    const { app, db } = await appWithAuth()
    seedOne(db)
    const { cookie, userId } = await signUp(app, 'owner@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId, role: 'owner', status: 'active', createdAt: TS })

    const res = await createOrg(app, { name: 'Org B' }, { cookie })
    expect(res.statusCode).toBe(201)
    assertUsableOrg(db, res.json().id as string, userId)
  })

  it('admin of an existing account is ALLOWED (admin tier = manageMembers)', async () => {
    const { app, db } = await appWithAuth()
    seedOne(db)
    const { cookie, userId } = await signUp(app, 'admin@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId, role: 'admin', status: 'active', createdAt: TS })

    const res = await createOrg(app, { name: 'Org C' }, { cookie })
    expect(res.statusCode).toBe(201)
    assertUsableOrg(db, res.json().id as string, userId)
  })

  it('a viewer/editor of an existing account is DENIED (below admin tier)', async () => {
    for (const role of ['viewer', 'editor'] as const) {
      const { app, db } = await appWithAuth()
      seedOne(db)
      const { cookie, userId } = await signUp(app, `${role}@capacitylens.dev`)
      upsertMember(db, { accountId: 'a1', userId, role, status: 'active', createdAt: TS })

      const res = await createOrg(app, { name: `Org ${role}` }, { cookie })
      expect(res.statusCode, `${role} denied`).toBe(403)
      expect(loadState(db).accounts.map((a) => a.id)).toEqual(['a1'])
    }
  })

  it('an INACTIVE owner membership does not count (treated as not-a-member) -> 403', async () => {
    const { app, db } = await appWithAuth()
    seedOne(db)
    const { cookie, userId } = await signUp(app, 'inactive@capacitylens.dev')
    // A non-active status is NOT a member for access purposes (see membership.ts ACTIVE-ONLY).
    upsertMember(db, { accountId: 'a1', userId, role: 'owner', status: 'invited' as never, createdAt: TS })

    const res = await createOrg(app, { name: 'Org D' }, { cookie })
    expect(res.statusCode).toBe(403)
  })

  it('a session-less request is 401 (requireUser is upstream of the org gate)', async () => {
    const { app, db } = await appWithAuth()
    seedOne(db)
    const res = await createOrg(app, { name: 'No Session' })
    expect(res.statusCode).toBe(401)
  })

  it('repairs the account row like the generic create: a non-hex colour falls back, id is server-minted', async () => {
    const { app, db } = await appWithAuth() // zero accounts -> the gate allows, so the create runs
    const { cookie, userId } = await signUp(app, 'repair@capacitylens.dev')
    const res = await createOrg(app, { name: 'Repaired', color: 'not-a-hex' }, { cookie })
    expect(res.statusCode).toBe(201)
    const id = res.json().id as string
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0) // server-minted when the body omits one
    const acc = loadState(db).accounts.find((a) => a.id === id)!
    expect(acc.color).toMatch(/^#[0-9a-fA-F]{6}$/) // junk colour repaired to a valid hex
    assertUsableOrg(db, id, userId)
  })
})

describe('POST /api/orgs (P1.8) — bootstrap token', () => {
  const TOKEN = 'a-very-long-random-bootstrap-token-value-0123456789'

  it('a member-less stranger with the MATCHING token may create an org once accounts exist', async () => {
    const { app, db } = await appWithAuth(TOKEN)
    seedOne(db)
    const { cookie, userId } = await signUp(app, 'operator@capacitylens.dev')

    const res = await createOrg(app, { name: 'Provisioned' }, { cookie, 'x-capacitylens-bootstrap-token': TOKEN })
    expect(res.statusCode).toBe(201)
    assertUsableOrg(db, res.json().id as string, userId)
  })

  it('a WRONG token is 403; an ABSENT token is 403 (stranger, accounts exist)', async () => {
    const { app, db } = await appWithAuth(TOKEN)
    seedOne(db)
    const { cookie } = await signUp(app, 'wrong@capacitylens.dev')

    const wrong = await createOrg(app, { name: 'X' }, { cookie, 'x-capacitylens-bootstrap-token': 'nope' })
    expect(wrong.statusCode).toBe(403)
    const absent = await createOrg(app, { name: 'Y' }, { cookie })
    expect(absent.statusCode).toBe(403)
    expect(loadState(db).accounts.map((a) => a.id)).toEqual(['a1'])
  })

  it('the token path is DISABLED when the env is unset: even the matching-looking header is 403', async () => {
    const { app, db } = await appWithAuth() // bootstrapToken undefined
    seedOne(db)
    const { cookie } = await signUp(app, 'noenv@capacitylens.dev')

    // An empty configured token can never match (bootstrapTokenMatches returns false on empty).
    const res = await createOrg(app, { name: 'Z' }, { cookie, 'x-capacitylens-bootstrap-token': '' })
    expect(res.statusCode).toBe(403)
  })
})

describe('POST /api/orgs (P1.8) — OFF mode (trusted-local)', () => {
  it('org creation is allowed; account + Internal + Owner(demo) membership are created', async () => {
    const db = openDb(':memory:')
    const app = buildApp(db) // authMode defaults to 'off'
    seedOne(db) // even with an account already present, OFF mode allows (trusted-local)

    const res = await createOrg(app, { name: 'Local Co' })
    expect(res.statusCode).toBe(201)
    assertUsableOrg(db, res.json().id as string, DEMO_USER.id)
  })
})

describe('POST /api/orgs (P1.8) — atomicity', () => {
  it('a failed insert rolls the WHOLE create back (no orphan account, client, or membership)', async () => {
    const { app, db } = await appWithAuth()
    const { cookie, userId } = await signUp(app, 'rollback@capacitylens.dev')

    // First create succeeds and fixes the account id.
    const ok = await createOrg(app, { name: 'Real Org' }, { cookie })
    expect(ok.statusCode).toBe(201)
    const id = ok.json().id as string
    const before = loadState(db)

    // Re-POST with the SAME explicit id: inserting the account row hits a PRIMARY KEY conflict, so the
    // tx throws and rolls back — no second Internal client, no membership churn, account list unchanged.
    const dup = await createOrg(app, { id, name: 'Dup Org' }, { cookie })
    expect(dup.statusCode).toBe(400) // constraint failure -> caller-fault 400
    const after = loadState(db)
    expect(after.accounts.map((a) => a.id).sort()).toEqual(before.accounts.map((a) => a.id).sort())
    expect(after.clients.filter((c) => c.accountId === id)).toHaveLength(1) // still exactly one Internal
    expect(resolveRole(db, { id: userId } as never, id)).toBe('owner') // membership unchanged
  })
})
