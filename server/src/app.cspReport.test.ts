import { beforeEach, describe, expect, it } from 'vitest'
import { authFromEnv, runAuthMigrations } from './auth'
import { buildApp } from './app'
import { openDb } from './db'
import { PASSWORD_ENV } from './testHelpers'

describe('CSP violation reporting', () => {
  let events: Record<string, unknown>[]

  beforeEach(() => {
    events = []
  })

  it('accepts a legacy browser report without a session and strips URL paths and queries', async () => {
    const db = openDb(':memory:')
    const { mode, auth } = authFromEnv(db, PASSWORD_ENV)
    await runAuthMigrations(auth!)
    const app = buildApp(db, {
      authMode: mode,
      auth,
      securityLog: (event) => events.push(event),
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/security/csp-report',
      headers: {
        'content-type': 'application/csp-report',
        host: 'localhost:8787',
        origin: 'http://localhost:8787',
        'sec-fetch-site': 'same-origin',
      },
      payload: JSON.stringify({
        'csp-report': {
          'document-uri': 'https://capacity.example.com/private/path?token=secret',
          'blocked-uri': 'https://cdn.example.net/script.js?code=secret',
          'effective-directive': 'script-src-elem',
          'violated-directive': 'script-src',
          disposition: 'enforce',
        },
      }),
    })

    expect(response.statusCode).toBe(204)
    expect(events).toEqual([
      {
        event: 'csp_violation',
        outcome: 'reported',
        documentOrigin: 'https://capacity.example.com',
        blockedOrigin: 'https://cdn.example.net',
        effectiveDirective: 'script-src-elem',
        violatedDirective: 'script-src',
        disposition: 'enforce',
      },
    ])
    expect(JSON.stringify(events)).not.toContain('secret')
    await app.close()
    db.close()
  })

  it('accepts the Reporting API array format and bounds one request to twenty events', async () => {
    const app = buildApp(openDb(':memory:'), { securityLog: (event) => events.push(event) })
    const reports = Array.from({ length: 25 }, () => ({
      type: 'csp-violation',
      body: {
        documentURL: 'https://capacity.example.com/',
        blockedURL: 'inline',
        effectiveDirective: 'style-src-elem',
        disposition: 'report',
      },
    }))
    const response = await app.inject({
      method: 'POST',
      url: '/api/security/csp-report',
      headers: { 'content-type': 'application/reports+json' },
      payload: JSON.stringify(reports),
    })

    expect(response.statusCode).toBe(204)
    expect(events).toHaveLength(20)
    expect(events[0]).toMatchObject({ blockedOrigin: 'inline', effectiveDirective: 'style-src-elem' })
    await app.close()
  })

  it('rejects malformed, oversized and cross-site report submissions', async () => {
    const app = buildApp(openDb(':memory:'), { securityLog: (event) => events.push(event) })
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/security/csp-report',
      headers: { 'content-type': 'application/csp-report' },
      payload: '{',
    })
    expect(malformed.statusCode).toBe(400)

    const oversized = await app.inject({
      method: 'POST',
      url: '/api/security/csp-report',
      headers: { 'content-type': 'application/csp-report' },
      payload: JSON.stringify({ padding: 'x'.repeat(65 * 1024) }),
    })
    expect(oversized.statusCode).toBe(413)

    const crossSite = await app.inject({
      method: 'POST',
      url: '/api/security/csp-report',
      headers: {
        'content-type': 'application/csp-report',
        origin: 'https://attacker.example',
        'sec-fetch-site': 'cross-site',
      },
      payload: '{}',
    })
    expect(crossSite.statusCode).toBe(403)
    expect(events).toContainEqual(
      expect.objectContaining({ event: 'cross_site_request', outcome: 'blocked' }),
    )
    await app.close()
  })
})
