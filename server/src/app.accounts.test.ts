import { describe, it, expect } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app'
import { openDb, insertAll, type Db } from './db'
import { upsertMember } from './controlTables'
import { authFromEnv, runAuthMigrations } from './auth'
import { PASSWORD_ENV, call, signUp } from './testHelpers'
import { emptyAppData, type AppData } from '@capacitylens/shared/types/entities'

// P1.4 endpoint coverage: GET /api/accounts + the new ?accountId= form of GET /api/state, in both
// OFF (trusted-local, no gate) and auth-on (membership-existence guard) postures. The no-arg
// GET /api/state whole read must stay byte-for-byte (backward-compat) — asserted here AND by the
// whole existing app.test.ts suite running unchanged.

const TS = '2026-01-01T00:00:00.000Z'
const meta = () => ({ createdAt: TS, updatedAt: TS })

const account = (id: string) => ({ id, name: `Studio ${id}`, color: '#3b82f6', ...meta() })
const client = (id: string, accountId: string) => ({ id, accountId, name: 'Acme', color: '#3b82f6', ...meta() })
const project = (id: string, accountId: string, clientId: string) => ({ id, accountId, name: 'Web', clientId, color: '#3b82f6', ...meta() })

/** Two accounts, each with a client + project, seeded directly via insertAll (parent-first). */
function seedTwo(db: Db): void {
  const d = emptyAppData() as unknown as Record<string, unknown[]>
  d.accounts = [account('a1'), account('a2')]
  d.clients = [client('c1', 'a1'), client('c2', 'a2')]
  d.projects = [project('p1', 'a1', 'c1'), project('p2', 'a2', 'c2')]
  insertAll(db, d as unknown as AppData)
}

describe('OFF mode — GET /api/accounts + GET /api/state?accountId=', () => {
  it('GET /api/accounts returns ALL seeded accounts as {id,name,role:owner} (no membership gate)', async () => {
    const db = openDb(':memory:')
    seedTwo(db)
    const app = buildApp(db)
    const res = await call(app, { method: 'GET', url: '/api/accounts' })
    expect(res.statusCode).toBe(200)
    // OFF mode tags every account with the trusted-local full-access sentinel role 'owner' (P1.12),
    // so the wire shape matches auth-on's AccountSummary and the client's pure `can` keeps OFF editable.
    expect(res.json()).toEqual([
      { id: 'a1', name: 'Studio a1', role: 'owner' },
      { id: 'a2', name: 'Studio a2', role: 'owner' },
    ])
  })

  it('GET /api/state?accountId=a1 returns ONLY a1; ?accountId=a2 returns ONLY a2', async () => {
    const db = openDb(':memory:')
    seedTwo(db)
    const app = buildApp(db)

    const s1 = (await call(app, { method: 'GET', url: '/api/state?accountId=a1' })).json()
    expect(s1.accounts.map((a: { id: string }) => a.id)).toEqual(['a1'])
    expect(s1.clients.map((c: { id: string }) => c.id)).toEqual(['c1'])
    expect(s1.projects.map((p: { id: string }) => p.id)).toEqual(['p1'])

    const s2 = (await call(app, { method: 'GET', url: '/api/state?accountId=a2' })).json()
    expect(s2.accounts.map((a: { id: string }) => a.id)).toEqual(['a2'])
    expect(s2.clients.map((c: { id: string }) => c.id)).toEqual(['c2'])
  })

  it('no-arg GET /api/state STILL returns the WHOLE tree (backward-compat)', async () => {
    const db = openDb(':memory:')
    seedTwo(db)
    const app = buildApp(db)
    const whole = (await call(app, { method: 'GET', url: '/api/state' })).json()
    expect(whole.accounts.map((a: { id: string }) => a.id).sort()).toEqual(['a1', 'a2'])
    expect(whole.clients).toHaveLength(2)
    expect(whole.projects).toHaveLength(2)
  })

  it('rejects an empty ?accountId= with 400', async () => {
    const db = openDb(':memory:')
    seedTwo(db)
    const app = buildApp(db)
    const res = await call(app, { method: 'GET', url: '/api/state?accountId=' })
    expect(res.statusCode).toBe(400)
  })
})

/** Build an auth-on (password) app over a fresh in-memory DB, returning both so the test can seed. */
async function appWithAuth(): Promise<{ app: FastifyInstance; db: Db }> {
  const db = openDb(':memory:')
  const { mode, auth } = authFromEnv(db, PASSWORD_ENV)
  await runAuthMigrations(auth!)
  return { app: buildApp(db, { authMode: mode, auth }), db }
}

describe('auth-on (password) — membership-existence guard', () => {
  it('a member reads their account slice (200); a non-member is 403; /api/accounts lists only memberships', async () => {
    const { app, db } = await appWithAuth()
    // Seed two accounts (directly — account creation flows aren't under test here).
    seedTwo(db)
    const { cookie, userId } = await signUp(app, 'member@capacitylens.dev')
    // Make the login an active member of a1 ONLY (as an editor — asserted on /api/accounts below).
    upsertMember(db, { accountId: 'a1', userId, role: 'editor', status: 'active', createdAt: TS })

    // Their account → 200 slice scoped to a1.
    const ok = await call(app, { method: 'GET', url: '/api/state?accountId=a1', headers: { cookie } })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().accounts.map((a: { id: string }) => a.id)).toEqual(['a1'])

    // A non-member account → 403 BEFORE any data leaves the DB.
    const denied = await call(app, { method: 'GET', url: '/api/state?accountId=a2', headers: { cookie } })
    expect(denied.statusCode).toBe(403)

    // /api/accounts returns ONLY their membership (a1) WITH the caller's role, not the full account list.
    const accts = await call(app, { method: 'GET', url: '/api/accounts', headers: { cookie } })
    expect(accts.statusCode).toBe(200)
    expect(accts.json()).toEqual([{ id: 'a1', name: 'Studio a1', role: 'editor' }])
  })

  it('a session-less request is still 401 (the requireUser gate is upstream of the slice guard)', async () => {
    const { app, db } = await appWithAuth()
    seedTwo(db)
    expect((await call(app, { method: 'GET', url: '/api/state?accountId=a1' })).statusCode).toBe(401)
    expect((await call(app, { method: 'GET', url: '/api/accounts' })).statusCode).toBe(401)
  })
})
