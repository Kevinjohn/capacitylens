import { describe, it, expect } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app'
import { openDb, insertAll, loadState, type Db } from './db'
import { upsertMember } from './controlTables'
import { resolveRole } from './membership'
import { authFromEnv, runAuthMigrations, DEMO_USER } from './auth'
import { PASSWORD_ENV, call, signUp } from './testHelpers'
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

/** Seed one pre-existing account directly (so "an account already exists" holds). */
function seedOne(db: Db): void {
  const d = emptyAppData() as unknown as Record<string, unknown[]>
  d.accounts = [account('a1')]
  insertAll(db, d as unknown as AppData)
}

/** Build an auth-on (password) app over a fresh in-memory DB. `bootstrapToken` is optional.
 *  `multiAccount` defaults to the single-company-cap OFF default (false); pass `true` for a test
 *  that deliberately provisions a 2nd/3rd org on the SAME instance — the cap otherwise 403s any
 *  create once ≥1 account exists, regardless of `allowed`'s authz outcome (see app.ts's GATE 0). */
async function appWithAuth(
  opts: { bootstrapToken?: string; multiAccount?: boolean } = {},
): Promise<{ app: FastifyInstance; db: Db }> {
  const db = openDb(':memory:')
  const { mode, auth } = authFromEnv(db, PASSWORD_ENV)
  await runAuthMigrations(auth!)
  return { app: buildApp(db, { authMode: mode, auth, bootstrapToken: opts.bootstrapToken, multiAccount: opts.multiAccount }), db }
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
    // multiAccount: true — the SECOND create below is exactly what the single-company cap denies by
    // default once any account exists (see the "default cap" describe block); this test is about the
    // `allowed` authz matrix (owner-of-existing may provision more), so it opts out of the cap.
    const { app, db } = await appWithAuth({ multiAccount: true })
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
    // multiAccount: true — see the zero-account-bootstrap test's note; the cap has its own describe
    // block below (this one is purely about the `allowed` authz tier).
    const { app, db } = await appWithAuth({ multiAccount: true })
    seedOne(db)
    const { cookie, userId } = await signUp(app, 'owner@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId, role: 'owner', status: 'active', createdAt: TS })

    const res = await createOrg(app, { name: 'Org B' }, { cookie })
    expect(res.statusCode).toBe(201)
    assertUsableOrg(db, res.json().id as string, userId)
  })

  it('admin of an existing account is ALLOWED (admin tier = manageMembers)', async () => {
    // multiAccount: true — see the zero-account-bootstrap test's note.
    const { app, db } = await appWithAuth({ multiAccount: true })
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
    // multiAccount: true — the token authorises WHO may create an org; it does NOT bypass the
    // single-company cap (see the "default cap" describe block for the token-does-NOT-bypass case).
    const { app, db } = await appWithAuth({ bootstrapToken: TOKEN, multiAccount: true })
    seedOne(db)
    const { cookie, userId } = await signUp(app, 'operator@capacitylens.dev')

    const res = await createOrg(app, { name: 'Provisioned' }, { cookie, 'x-capacitylens-bootstrap-token': TOKEN })
    expect(res.statusCode).toBe(201)
    assertUsableOrg(db, res.json().id as string, userId)
  })

  it('a WRONG token is 403; an ABSENT token is 403 (stranger, accounts exist)', async () => {
    const { app, db } = await appWithAuth({ bootstrapToken: TOKEN })
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
    // multiAccount: true — the single-company cap applies in EVERY auth mode INCLUDING off (it's a
    // deployment-shape policy, not an authz rule; see the "default cap" describe block for the
    // OFF-mode-does-NOT-bypass case). This test is about OFF's trusted-local authz no-op, so it
    // opts out of the cap to keep exercising the pre-existing "an account already exists" scenario.
    const app = buildApp(db, { multiAccount: true }) // authMode defaults to 'off'
    seedOne(db) // even with an account already present, OFF mode allows (trusted-local)

    const res = await createOrg(app, { name: 'Local Co' })
    expect(res.statusCode).toBe(201)
    assertUsableOrg(db, res.json().id as string, DEMO_USER.id)
  })
})

describe('POST /api/orgs (P1.8) — atomicity', () => {
  it('a failed insert rolls the WHOLE create back (no orphan account, client, or membership)', async () => {
    // multiAccount: true — the "Dup Org" re-POST below is, from the cap's point of view, ANOTHER
    // create attempt (accountCount is 1 after the first succeeds); without this the cap would 403
    // it before the intended PRIMARY KEY conflict is ever reached, testing the wrong thing.
    const { app, db } = await appWithAuth({ multiAccount: true })
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

// Single-company cap (AppOptions.multiAccount, default false — see app.ts's GATE 0). Every test
// above that provisions a 2nd/3rd org threads `multiAccount: true` to keep locking the `allowed`
// authz matrix undisturbed; THIS block pins the cap itself: it denies a 2nd org create (via every
// `allowed` path — owner, bootstrap token, OFF mode) with the actionable policy message, NOT the
// generic 'Forbidden.', and never touches the first-run (zero-account) bootstrap.
describe('POST /api/orgs (P1.8) — single-company cap (default multiAccount: false)', () => {
  const CAP_MESSAGE = 'This instance allows a single company. Set CAPACITYLENS_MULTI_ACCOUNT=1 to allow more.'

  it('first org on a zero-account instance still succeeds (201, unchanged)', async () => {
    const { app } = await appWithAuth() // multiAccount defaults to false; zero accounts
    const { cookie } = await signUp(app, 'first-org-cap@capacitylens.dev')
    const res = await createOrg(app, { name: 'First Studio' }, { cookie })
    expect(res.statusCode).toBe(201)
  })

  it('2nd org via an owner of an existing account -> 403 policy message, NOT 201', async () => {
    const { app, db } = await appWithAuth() // multiAccount defaults to false
    seedOne(db) // an account already exists
    const { cookie, userId } = await signUp(app, 'owner-cap@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId, role: 'owner', status: 'active', createdAt: TS })

    const res = await createOrg(app, { name: 'Second Studio' }, { cookie })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: CAP_MESSAGE })
    expect(loadState(db).accounts.map((a) => a.id)).toEqual(['a1']) // nothing created
  })

  it('2nd org via a MATCHING bootstrap token -> 403 policy message (the token authorises WHO, not WHETHER)', async () => {
    const TOKEN = 'a-very-long-random-bootstrap-token-value-0123456789'
    const { app, db } = await appWithAuth({ bootstrapToken: TOKEN }) // multiAccount defaults to false
    seedOne(db)
    const { cookie } = await signUp(app, 'operator-cap@capacitylens.dev')

    const res = await createOrg(app, { name: 'Provisioned' }, { cookie, 'x-capacitylens-bootstrap-token': TOKEN })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: CAP_MESSAGE })
    expect(loadState(db).accounts.map((a) => a.id)).toEqual(['a1'])
  })

  it('2nd org in OFF mode -> 403 policy message (OFF is trusted-local for authz, but the cap is NOT an authz rule)', async () => {
    const db = openDb(':memory:')
    const app = buildApp(db) // authMode defaults to 'off'; multiAccount defaults to false
    seedOne(db)

    const res = await createOrg(app, { name: 'Local Co 2' })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: CAP_MESSAGE })
    expect(loadState(db).accounts.map((a) => a.id)).toEqual(['a1'])
  })
})

// GET /api/auth/me `canCreateAccount` must MIRROR the POST /api/orgs gate (userMayCreateAccount +
// the cap) — the bug this pins: the flag used to come from the instance cap alone, so an auth-on
// editor / membership-less user was shown a "New company" affordance whose POST always 403'd. All
// auth-on cases run with multiAccount: true so the cap never masks the WHO tier under test; the
// bootstrap-token arm is deliberately absent (curl-only — it never lights the flag; see
// userMayCreateAccount's doc comment).
describe('GET /api/auth/me — canCreateAccount mirrors the /api/orgs gate', () => {
  const me = (app: FastifyInstance, cookie?: string) =>
    call(app, { method: 'GET', url: '/api/auth/me', ...(cookie ? { headers: { cookie } } : {}) })

  it('auth-on + multiAccount, editor-only membership -> canCreateAccount:false (POST /api/orgs would 403)', async () => {
    const { app, db } = await appWithAuth({ multiAccount: true })
    seedOne(db)
    const { cookie, userId } = await signUp(app, 'editor-flag@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId, role: 'editor', status: 'active', createdAt: TS })

    const res = await me(app, cookie)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ multiAccount: true, canCreateAccount: false })
    // The flag and the gate agree: the create it would advertise is exactly the one that 403s.
    const post = await createOrg(app, { name: 'Editor Org' }, { cookie })
    expect(post.statusCode).toBe(403)
  })

  it('auth-on + multiAccount, NO membership anywhere -> canCreateAccount:false', async () => {
    const { app, db } = await appWithAuth({ multiAccount: true })
    seedOne(db)
    const { cookie } = await signUp(app, 'nomember-flag@capacitylens.dev')

    const res = await me(app, cookie)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ multiAccount: true, canCreateAccount: false })
  })

  it('auth-on + multiAccount, active OWNER of an existing account -> canCreateAccount:true', async () => {
    const { app, db } = await appWithAuth({ multiAccount: true })
    seedOne(db)
    const { cookie, userId } = await signUp(app, 'owner-flag@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId, role: 'owner', status: 'active', createdAt: TS })

    const res = await me(app, cookie)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ multiAccount: true, canCreateAccount: true })
  })

  it('auth-on + multiAccount, active ADMIN of an existing account -> canCreateAccount:true (admin tier)', async () => {
    const { app, db } = await appWithAuth({ multiAccount: true })
    seedOne(db)
    const { cookie, userId } = await signUp(app, 'admin-flag@capacitylens.dev')
    upsertMember(db, { accountId: 'a1', userId, role: 'admin', status: 'active', createdAt: TS })

    const res = await me(app, cookie)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ multiAccount: true, canCreateAccount: true })
  })

  it('auth-on, ZERO accounts -> canCreateAccount:true (first-run bootstrap, even with no membership)', async () => {
    const { app } = await appWithAuth() // multiAccount defaults to false; zero accounts
    const { cookie } = await signUp(app, 'bootstrap-flag@capacitylens.dev')

    const res = await me(app, cookie)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ multiAccount: false, canCreateAccount: true })
  })

  it('OFF mode + multiAccount -> canCreateAccount:true (trusted-local, no membership tier)', async () => {
    const db = openDb(':memory:')
    seedOne(db)
    const app = buildApp(db, { multiAccount: true }) // authMode defaults to 'off'
    const res = await me(app)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ multiAccount: true, canCreateAccount: true })
  })

  it('anon caller on an auth-on instance: the 401 shape carries NO capability flags', async () => {
    const { app, db } = await appWithAuth({ multiAccount: true })
    seedOne(db)
    const res = await me(app) // no cookie
    expect(res.statusCode).toBe(401)
    expect(res.json()).not.toHaveProperty('canCreateAccount')
    expect(res.json()).not.toHaveProperty('multiAccount')
  })
})
