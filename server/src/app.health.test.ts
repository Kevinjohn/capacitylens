import { describe, it, expect } from 'vitest'
import { buildApp } from './app'
import { openDb } from './db'

// P1.4 (flag CAPACITYLENS_HEALTH_DEEP → opts.healthDeep): ON makes /api/health prove the DB
// answers a trivial read; OFF keeps today's unconditional { ok: true } — the exact body
// Playwright's webServer probe (and anything else pinned to it) depends on.

describe('CAPACITYLENS_HEALTH_DEEP on', () => {
  it('reports { ok, db: true, audit: ok } while the DB answers and the audit sink is healthy', async () => {
    // P1.15: deep-health also surfaces the audit sink state. The factory default is a noop sink
    // (never degraded), so a healthy server reports audit:'ok'.
    const app = buildApp(openDb(':memory:'), { healthDeep: true })
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, db: true, audit: 'ok' })
  })

  it('returns 503 { ok: false } when the DB read throws', async () => {
    const db = openDb(':memory:')
    const app = buildApp(db, { healthDeep: true })
    db.close()
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ ok: false })
  })
})

describe('CAPACITYLENS_HEALTH_DEEP off (default)', () => {
  it('returns exactly the current body, even with the DB closed', async () => {
    const db = openDb(':memory:')
    const app = buildApp(db)
    db.close()
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })
})
