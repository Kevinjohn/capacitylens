import { describe, it, expect } from 'vitest'
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify'
import { buildApp } from './app'
import { openDb, insertAll, type Db } from './db'
import { emptyAppData, type AppData } from '@capacitylens/shared/types/entities'

// Single-company-per-instance cap (AppOptions.multiAccount, default false — see app.ts's
// accountCreateCapped / SINGLE_COMPANY_CAP_MESSAGE / the "GATE 0" comment on POST /api/orgs). This
// suite drives the THREE GENERIC entity-route vectors that could CREATE a NEW `accounts` row — the
// bare POST /api/accounts, the PUT-as-create upsert, and the batch PUT-accounts pre-scan — proving
// each 403s with the actionable policy message once ≥1 account exists, that an UPDATE/PATCH of an
// EXISTING account is NEVER affected (create-time only), and that multiAccount:true restores the
// old open-create behaviour. Run entirely in OFF mode: the cap is DELIBERATELY not an authz rule (it
// applies in every auth mode, including off's otherwise-trusted-local allow-all), so it is fully
// exercisable here with no Better Auth harness — auth-on coverage of the SAME cap already lives
// alongside the authz matrix in app.authz.test.ts and app.orgs.test.ts (POST /api/orgs has its own
// dedicated cap suite there).

const TS = '2026-01-01T00:00:00.000Z'
const meta = () => ({ createdAt: TS, updatedAt: TS })
const account = (id: string, name = `Studio ${id}`) => ({ id, name, color: '#3b82f6', ...meta() })

const CAP_MESSAGE = 'This instance allows a single company. Set CAPACITYLENS_MULTI_ACCOUNT=1 to allow more.'

const call = (app: FastifyInstance, opts: InjectOptions): Promise<LightMyRequestResponse> =>
  app.inject(opts) as unknown as Promise<LightMyRequestResponse>

/** One pre-existing account ('a1') so "the cap is at capacity" holds (accountCount === 1). */
function atCapDb(): Db {
  const db = openDb(':memory:')
  insertAll(db, { ...emptyAppData(), accounts: [account('a1')] } as unknown as AppData)
  return db
}

describe('single-company cap — POST /api/accounts (generic create)', () => {
  it('at-cap (an account already exists), default opts: a NEW account -> 403 policy message', async () => {
    const app = buildApp(atCapDb(), { optimisticConcurrency: false })
    const res = await call(app, { method: 'POST', url: '/api/accounts', payload: account('brandNew') })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toMatchObject({ error: CAP_MESSAGE, code: 'FORBIDDEN' })
    expect(res.json().commandId).toEqual(expect.any(String))
  })

  it('zero accounts: the FIRST account still succeeds (201) — the bootstrap case is unaffected', async () => {
    const app = buildApp(openDb(':memory:'))
    const res = await call(app, { method: 'POST', url: '/api/accounts', payload: account('firstOne') })
    expect(res.statusCode).toBe(201)
  })

  it('replays the committed row when server-owned timestamps change between POST retries', async () => {
    const app = buildApp(openDb(':memory:'))
    const headers = {
      'idempotency-key': 'generic-post-replay-key-0001',
      'x-account-command-id': 'generic-post-replay-command-001',
    }
    const first = await call(app, {
      method: 'POST', url: '/api/accounts', payload: account('replayed-post'), headers,
    })
    const replay = await call(app, {
      method: 'POST', url: '/api/accounts', payload: account('replayed-post'), headers,
    })
    expect(first.statusCode, first.body).toBe(201)
    expect(replay.statusCode, replay.body).toBe(201)
    expect(replay.json()).toEqual(first.json())
  })

  it('multiAccount: true restores the open create even at-cap', async () => {
    const app = buildApp(atCapDb(), { multiAccount: true })
    const res = await call(app, { method: 'POST', url: '/api/accounts', payload: account('brandNew2') })
    expect(res.statusCode).toBe(201)
  })
})

describe('single-company cap — PUT /api/accounts/:id (create-via-upsert)', () => {
  it('at-cap: PUT a brand-new id (no existing row) -> 403 policy message', async () => {
    const app = buildApp(atCapDb())
    const res = await call(app, { method: 'PUT', url: '/api/accounts/brandNew', payload: account('brandNew') })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: CAP_MESSAGE })
  })

  it('at-cap: PUT of the EXISTING account (an UPDATE) still succeeds — the cap is create-time only', async () => {
    const app = buildApp(atCapDb())
    const res = await call(app, { method: 'PUT', url: '/api/accounts/a1', payload: account('a1', 'Renamed') })
    expect(res.statusCode).toBe(200)
  })

  it('multiAccount: true restores the open create even at-cap', async () => {
    const app = buildApp(atCapDb(), { multiAccount: true })
    const res = await call(app, { method: 'PUT', url: '/api/accounts/brandNew3', payload: account('brandNew3') })
    expect(res.statusCode).toBe(200)
  })

  it('replays the committed row when server-owned timestamps change between PUT retries', async () => {
    const app = buildApp(openDb(':memory:'))
    const headers = {
      'idempotency-key': 'generic-put-replay-key-00001',
      'x-account-command-id': 'generic-put-replay-command-0001',
    }
    const first = await call(app, {
      method: 'PUT', url: '/api/accounts/replayed-put', payload: account('replayed-put'), headers,
    })
    const replay = await call(app, {
      method: 'PUT', url: '/api/accounts/replayed-put', payload: account('replayed-put'), headers,
    })
    expect(first.statusCode, first.body).toBe(200)
    expect(replay.statusCode, replay.body).toBe(200)
    expect(replay.json()).toEqual(first.json())
  })
})

describe('single-company cap — PATCH /api/accounts/:id (never a create — sanity)', () => {
  it('at-cap: PATCH of the EXISTING account still succeeds, unaffected by the cap', async () => {
    const app = buildApp(atCapDb(), { optimisticConcurrency: false })
    const res = await call(app, { method: 'PATCH', url: '/api/accounts/a1', payload: { name: 'Patched' } })
    expect(res.statusCode).toBe(200)
  })
})

describe('single-company cap — POST /api/batch (accounts-PUT pre-scan)', () => {
  const batchPutAccount = (app: FastifyInstance, id: string, name?: string) =>
    call(app, {
      method: 'POST',
      url: '/api/batch',
      payload: { ops: [{ method: 'PUT', table: 'accounts', id, row: account(id, name) }] },
    })

  it('at-cap: a batch PUT-accounts CREATE -> the WHOLE batch 403s with the policy message', async () => {
    const app = buildApp(atCapDb())
    const res = await batchPutAccount(app, 'brandNew4')
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: CAP_MESSAGE })
  })

  it('zero accounts: the first batch-created account succeeds with its owner membership', async () => {
    const db = openDb(':memory:')
    const app = buildApp(db)
    const res = await batchPutAccount(app, 'first')

    expect(res.statusCode).toBe(200)
    expect((await call(app, { method: 'GET', url: '/api/state' })).json().accounts)
      .toEqual([expect.objectContaining({ id: 'first' })])
  })

  it('serializes concurrent first-account batches and lets only one pass the cap', async () => {
    const db = openDb(':memory:')
    const app = buildApp(db)
    const responses = await Promise.all([
      batchPutAccount(app, 'concurrent-first'),
      batchPutAccount(app, 'concurrent-second'),
    ])

    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 403])
    expect((await call(app, { method: 'GET', url: '/api/state' })).json().accounts).toHaveLength(1)
  })

  it('projects all creates in one batch, so two accounts cannot pass against the same empty snapshot', async () => {
    const db = openDb(':memory:')
    const app = buildApp(db)
    const res = await call(app, {
      method: 'POST',
      url: '/api/batch',
      payload: {
        ops: [
          { method: 'PUT', table: 'accounts', id: 'first', row: account('first') },
          { method: 'PUT', table: 'accounts', id: 'second', row: account('second') },
        ],
      },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: CAP_MESSAGE })
    const state = await call(app, { method: 'GET', url: '/api/state' })
    expect(state.json().accounts).toEqual([])
  })

  it('allows an atomic one-for-one account replacement whose projected final count is one', async () => {
    const db = atCapDb()
    const app = buildApp(db)
    const res = await call(app, {
      method: 'POST',
      url: '/api/batch',
      payload: {
        ops: [
          { method: 'DELETE', table: 'accounts', id: 'a1' },
          { method: 'PUT', table: 'accounts', id: 'replacement', row: account('replacement') },
        ],
      },
    })
    expect(res.statusCode).toBe(200)
    const state = await call(app, { method: 'GET', url: '/api/state' })
    expect(state.json().accounts.map((row: { id: string }) => row.id)).toEqual(['replacement'])
  })

  it('applies the cap to final batch state even when replacement creation precedes deletion', async () => {
    const db = atCapDb()
    const app = buildApp(db)
    const res = await call(app, {
      method: 'POST',
      url: '/api/batch',
      payload: {
        ops: [
          { method: 'PUT', table: 'accounts', id: 'replacement', row: account('replacement') },
          { method: 'DELETE', table: 'accounts', id: 'a1' },
        ],
      },
    })

    expect(res.statusCode).toBe(200)
    const state = await call(app, { method: 'GET', url: '/api/state' })
    expect(state.json().accounts.map((row: { id: string }) => row.id)).toEqual(['replacement'])
  })

  it('at-cap: a batch PUT-accounts UPDATE of the EXISTING account still succeeds', async () => {
    const app = buildApp(atCapDb())
    const res = await batchPutAccount(app, 'a1', 'Renamed via batch')
    expect(res.statusCode).toBe(200)
  })

  it('multiAccount: true restores the open batch create even at-cap', async () => {
    const app = buildApp(atCapDb(), { multiAccount: true })
    const res = await batchPutAccount(app, 'brandNew5')
    expect(res.statusCode).toBe(200)
  })

  it('a MIXED batch (a valid accounts-UPDATE alongside a capped accounts-CREATE) rejects the WHOLE batch, no partial write', async () => {
    const db = atCapDb()
    const app = buildApp(db)
    const res = await call(app, {
      method: 'POST',
      url: '/api/batch',
      payload: {
        ops: [
          { method: 'PUT', table: 'accounts', id: 'a1', row: account('a1', 'Renamed') }, // an UPDATE, would pass alone
          { method: 'PUT', table: 'accounts', id: 'brandNew6', row: account('brandNew6') }, // a CREATE, capped
        ],
      },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: CAP_MESSAGE })
    // Pre-scan rejected the batch before the tx opened — a1 was NOT renamed.
    const state = await call(app, { method: 'GET', url: '/api/state?accountId=a1' })
    expect(state.json().accounts[0].name).toBe(account('a1').name)
  })
})

describe('single-company cap — GET /api/auth/me capability flags', () => {
  it('off-mode, zero accounts: multiAccount:false, canCreateAccount:true', async () => {
    const app = buildApp(openDb(':memory:'))
    const res = await call(app, { method: 'GET', url: '/api/auth/me' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ multiAccount: false, canCreateAccount: true })
  })

  it('off-mode, one account already exists: canCreateAccount:false', async () => {
    const app = buildApp(atCapDb())
    const res = await call(app, { method: 'GET', url: '/api/auth/me' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ multiAccount: false, canCreateAccount: false })
  })

  it('multiAccount: true -> canCreateAccount:true regardless of existing accounts', async () => {
    const app = buildApp(atCapDb(), { multiAccount: true })
    const res = await call(app, { method: 'GET', url: '/api/auth/me' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ multiAccount: true, canCreateAccount: true })
  })
})
