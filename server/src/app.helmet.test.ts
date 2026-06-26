import { describe, it, expect } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app'
import { openDb } from './db'

// P0.5.3 (@fastify/helmet → baseline security headers): an API-only server returns JSON,
// so a strict CSP is safe. These headers are pure hardening and ON by default — nosniff,
// a CSP carrying frame-ancestors 'none' + connect-src 'self', a no-referrer Referrer-Policy,
// and X-Frame-Options: DENY for legacy browsers. HSTS is the ONE header gated OFF by default
// (opts.https / CAPACITYLENS_HTTPS=1) because it is only valid over real HTTPS — this server
// typically runs HTTP behind a TLS-terminating proxy, where HSTS would be harmful.

const health = (app: FastifyInstance) => app.inject({ method: 'GET', url: '/api/health' })

describe('baseline security headers (helmet, on by default)', () => {
  it('sets nosniff', async () => {
    const app = buildApp(openDb(':memory:'))
    expect((await health(app)).headers['x-content-type-options']).toBe('nosniff')
  })

  it('emits a CSP carrying frame-ancestors none and connect-src self', async () => {
    const app = buildApp(openDb(':memory:'))
    const csp = (await health(app)).headers['content-security-policy']
    expect(typeof csp).toBe('string')
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("connect-src 'self'")
  })

  it('keeps the CSP to the minimal set — no helmet defaults merged in', async () => {
    // useDefaults:false means we emit EXACTLY our five directives. Lock out the two defaults
    // that would otherwise ship unintentionally: 'unsafe-inline' (from helmet's style-src) and
    // upgrade-insecure-requests. A future helmet bump that flipped the merge back on fails here.
    const app = buildApp(openDb(':memory:'))
    const csp = (await health(app)).headers['content-security-policy']
    expect(csp).not.toContain('upgrade-insecure-requests')
    expect(csp).not.toContain('unsafe-inline')
    // ...while the intended directives are still present.
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("connect-src 'self'")
  })

  it('keeps the cross-origin contract: CORP same-origin, COEP off', async () => {
    // The cross-origin client→server flow (CORS-mode fetch) depends on COEP staying OFF —
    // enabling Cross-Origin-Embedder-Policy could break it. CORP same-origin is helmet's
    // default and harmless here (JSON-only API). Pin both so a helmet bump can't regress them.
    const headers = (await health(buildApp(openDb(':memory:')))).headers
    expect(headers['cross-origin-resource-policy']).toBe('same-origin')
    expect(headers['cross-origin-embedder-policy']).toBeUndefined()
  })

  it('sets a strict Referrer-Policy', async () => {
    const app = buildApp(openDb(':memory:'))
    expect((await health(app)).headers['referrer-policy']).toBe('no-referrer')
  })

  it('sets X-Frame-Options: DENY for legacy browsers', async () => {
    const app = buildApp(openDb(':memory:'))
    expect((await health(app)).headers['x-frame-options']).toBe('DENY')
  })
})

describe('HSTS — off by default, on behind the HTTPS flag', () => {
  it('omits Strict-Transport-Security by default (HTTP behind a TLS proxy)', async () => {
    const app = buildApp(openDb(':memory:'))
    expect((await health(app)).headers['strict-transport-security']).toBeUndefined()
  })

  it('emits Strict-Transport-Security only when https: true', async () => {
    const app = buildApp(openDb(':memory:'), { https: true })
    const hsts = (await health(app)).headers['strict-transport-security']
    expect(typeof hsts).toBe('string')
    expect(hsts).toContain('max-age=15552000')
    expect(hsts).toContain('includeSubDomains')
  })
})
