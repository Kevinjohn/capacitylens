import { describe, it, expect } from 'vitest'
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify'
import { buildApp } from './app'
import { openDb, type Db } from './db'
import { authFromEnv, runAuthMigrations } from './auth'

// P1.17 — the Phase-1 CAPSTONE. "Retire the open shared dataset": in the HOSTED (auth-on) posture
// there must be ZERO unauthenticated /api access. The requireUser preHandler (app.ts) is the single
// chokepoint — every /api/* route EXCEPT /api/health + /api/auth/* must 401 a no-session request,
// and the 401 body must be the plain no-data error (the open shared dataset never serialises). This
// suite is the consolidated 401-matrix proof; it makes NO-session requests (it never attaches a
// session cookie). OFF stays the trusted-local self-hoster default (asserted at the end) — P1.17
// closes the HOSTED door without flipping the auth-off-by-default invariant.
//
// NB: the behaviour already exists (the requireUser chokepoint, P3.2 / P1.5 / P1.13). This is the
// capstone TEST that pins it as a contract, plus the defensive guard that any FUTURE /api route
// without auth coverage is a one-line add to the matrix below (and a visible omission if forgotten).

const TS = '2026-01-01T00:00:00.000Z'
const client = { id: 'c1', accountId: 'a1', name: 'Acme', color: '#3b82f6', createdAt: TS, updatedAt: TS }

const call = (app: FastifyInstance, opts: InjectOptions): Promise<LightMyRequestResponse> =>
  app.inject(opts) as unknown as Promise<LightMyRequestResponse>

const PASSWORD_ENV = {
  CAPACITYLENS_AUTH: 'password',
  BETTER_AUTH_SECRET: 'unit-test-secret-0123456789abcdef-0123',
  BETTER_AUTH_URL: 'http://localhost:8787',
}

/**
 * Build an AUTH-ON (password) app over a fresh in-memory DB. `allowReset: true` is deliberate: it
 * lets the matrix prove requireUser 401s `POST /api/test/reset` BEFORE the allowReset check runs, so
 * an unauthenticated reset can NEVER wipe data in the hosted posture.
 */
async function appWithAuth(): Promise<{ app: FastifyInstance; db: Db }> {
  const db = openDb(':memory:')
  const { mode, auth } = authFromEnv(db, PASSWORD_ENV)
  await runAuthMigrations(auth!)
  return { app: buildApp(db, { authMode: mode, auth, allowReset: true }), db }
}

/** Build an OFF (trusted-local) app — no authMode ⇒ off; allowReset on to mirror appWithAuth. */
function offApp(): FastifyInstance {
  return buildApp(openDb(':memory:'), { allowReset: true })
}

// Every /api/* route EXCEPT /api/health + /api/auth/* MUST 401 unauthenticated in the hosted posture
// (P1.17). This table IS the contract: a future /api route is one line to add here — and a missing
// line is a visible gap. Each entry is a NO-session request (no cookie attached). Per the spec, the
// route families covered are: the read endpoints; the generic per-entity CRUD; batch; import; orgs;
// the invite flow; the member/invite management routes; and the test-only reset.
const BLOCKED_ROUTES: ReadonlyArray<{ name: string; opts: InjectOptions }> = [
  { name: 'GET /api/accounts', opts: { method: 'GET', url: '/api/accounts' } },
  { name: 'GET /api/state?accountId=', opts: { method: 'GET', url: '/api/state?accountId=a1' } },
  { name: 'GET /api/state (no-arg)', opts: { method: 'GET', url: '/api/state' } },
  { name: 'GET /api/meta', opts: { method: 'GET', url: '/api/meta' } },
  { name: 'POST /api/:entity', opts: { method: 'POST', url: '/api/clients', payload: client } },
  { name: 'PUT /api/:entity/:id', opts: { method: 'PUT', url: '/api/clients/c1', payload: client } },
  { name: 'PATCH /api/:entity/:id', opts: { method: 'PATCH', url: '/api/clients/c1', payload: { name: 'X' } } },
  { name: 'DELETE /api/:entity/:id', opts: { method: 'DELETE', url: '/api/clients/c1?accountId=a1' } },
  {
    name: 'POST /api/batch',
    opts: { method: 'POST', url: '/api/batch', payload: { ops: [{ method: 'PUT', table: 'clients', id: 'c1', row: client }] } },
  },
  { name: 'POST /api/import', opts: { method: 'POST', url: '/api/import', payload: { accountId: 'a1', data: { clients: [client] } } } },
  { name: 'POST /api/orgs', opts: { method: 'POST', url: '/api/orgs', payload: { name: 'New Org' } } },
  { name: 'POST /api/invites', opts: { method: 'POST', url: '/api/invites', payload: { accountId: 'a1', email: 'x@y.test', role: 'editor' } } },
  { name: 'POST /api/invites/:token/accept', opts: { method: 'POST', url: '/api/invites/tok/accept', payload: {} } },
  { name: 'GET /api/accounts/:id/members', opts: { method: 'GET', url: '/api/accounts/a1/members' } },
  { name: 'PATCH /api/accounts/:id/members/:userId', opts: { method: 'PATCH', url: '/api/accounts/a1/members/u1', payload: { role: 'editor' } } },
  { name: 'DELETE /api/accounts/:id/members/:userId', opts: { method: 'DELETE', url: '/api/accounts/a1/members/u1' } },
  { name: 'GET /api/accounts/:id/invites', opts: { method: 'GET', url: '/api/accounts/a1/invites' } },
  { name: 'DELETE /api/accounts/:id/invites/:id', opts: { method: 'DELETE', url: '/api/accounts/a1/invites/i1' } },
  // allowReset is TRUE on this app, so a 401 here proves requireUser fires BEFORE the allowReset
  // check — an unauthenticated reset can't wipe data in the hosted posture.
  { name: 'POST /api/test/reset', opts: { method: 'POST', url: '/api/test/reset', payload: { seed: true } } },
]

describe('P1.17 retire the open shared dataset — hosted (auth-on) posture serves ZERO unauthenticated /api access', () => {
  it.each(BLOCKED_ROUTES)('$name → 401 with the no-data error (no session)', async ({ opts }) => {
    const { app } = await appWithAuth()
    const res = await call(app, opts)
    expect(res.statusCode).toBe(401)
    // The retire proof: the blocked body is the plain requireUser 401 — the open shared dataset is
    // never served. (requireUser's 401 is exactly `{ error: 'Sign in to continue.' }` — note it has
    // NO `authMode` key, which distinguishes it from the /api/auth/me 401 handled by the auth layer.)
    expect(res.json()).toEqual({ error: 'Sign in to continue.' })
  })

  it('GET /api/health → 200 (exempt: the uptime monitor has no session)', async () => {
    const { app } = await appWithAuth()
    const res = await call(app, { method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('GET /api/auth/me is handled by the auth layer, NOT requireUser-blocked (401 carries authMode)', async () => {
    // /api/auth/* is exempt from requireUser; the auth layer answers it. A no-session /api/auth/me
    // is reachable and 401s with the login-screen shape `{ authMode, error }` — the `authMode` key
    // (absent from requireUser's 401) is the tell that the auth layer, not requireUser, answered.
    const { app } = await appWithAuth()
    const res = await call(app, { method: 'GET', url: '/api/auth/me' })
    expect(res.statusCode).toBe(401)
    expect(res.json().authMode).toBe('password')
    expect(res.json().error).toBe('Sign in to continue.')
  })
})

describe('P1.17 — OFF stays the trusted-local self-hoster default (auth-off-by-default invariant intact)', () => {
  // P1.17 closes the HOSTED door; it does NOT flip the global OFF default. OFF = trusted-local: the
  // open shared dataset IS the deliberate self-hoster default, so an unauthenticated request is NOT
  // 401'd (requireUser attaches DEMO_USER and continues). This pins that P1.17 left OFF unchanged.
  it('representative unauthenticated reads are NOT 401 in OFF (DEMO_USER, open dataset served)', async () => {
    const app = offApp()
    // No cookie, no session — yet OFF serves these (the open shared dataset is the default deploy).
    expect((await call(app, { method: 'GET', url: '/api/accounts' })).statusCode).not.toBe(401)
    expect((await call(app, { method: 'GET', url: '/api/state?accountId=a1' })).statusCode).not.toBe(401)
    expect((await call(app, { method: 'GET', url: '/api/state' })).statusCode).toBe(200) // no-arg whole read retained in OFF
  })
})
