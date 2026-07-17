import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildApp } from './app'
import { openDb } from './db'
import { authFromEnv, runAuthMigrations } from './auth'
import { PASSWORD_ENV } from './testHelpers'

// P1.3 (flag CAPACITYLENS_LOG → opts.log): ON gives structured per-request JSON via Fastify's
// bundled pino and routes the 500-path error through the request logger; OFF is byte-for-
// byte today's behaviour (no request logs, bare console.error on 500s). The logStream
// seam exists only so these tests can read the JSON lines instead of stdout.

function capture() {
  const lines: string[] = []
  return { lines, stream: { write: (msg: string) => void lines.push(msg) } }
}

afterEach(() => vi.restoreAllMocks())

describe('CAPACITYLENS_LOG on', () => {
  it('emits method/path/status request-completion JSON lines', async () => {
    const { lines, stream } = capture()
    const app = buildApp(openDb(':memory:'), { log: true, logStream: stream })
    await app.inject({ method: 'GET', url: '/api/health' })
    const out = lines.join('')
    expect(out).toContain('"url":"/api/health"')
    expect(out).toContain('"method":"GET"')
    expect(out).toContain('"statusCode":200')
    expect(out).toContain('request completed')
  })

  it('routes the 500-path error through the request logger, not console.error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { lines, stream } = capture()
    const db = openDb(':memory:')
    const app = buildApp(db, { log: true, logStream: stream })
    db.close() // /api/state now throws → the 500 redaction funnel
    const res = await app.inject({ method: 'GET', url: '/api/state' })
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: 'Internal server error' }) // body still generic
    expect(consoleError).not.toHaveBeenCalled()
    expect(lines.join('')).toContain('"level":50') // pino error line carries the real cause
  })
})

describe('CAPACITYLENS_LOG redaction (P0.5.5)', () => {
  // The meaningful proof: pino's redact (remove:true) strips these EXACT paths. Default
  // serializers don't log headers, so we emit a record carrying the redacted paths directly
  // with sentinel secrets, then assert the secrets are gone but the line WAS emitted.
  it('removes authorization/cookie/set-cookie values from records carrying those paths', async () => {
    const { lines, stream } = capture()
    const app = buildApp(openDb(':memory:'), { log: true, logStream: stream })
    app.log.info(
      {
        req: { headers: { authorization: 'SENTINEL_AUTH_TOKEN', cookie: 'SENTINEL_COOKIE' } },
        res: { headers: { 'set-cookie': 'SENTINEL_SETCOOKIE' } },
      },
      'probe',
    )
    const out = lines.join('')
    expect(out).toContain('"msg":"probe"') // the line WAS emitted (can't pass by logging nothing)
    expect(out).not.toContain('SENTINEL_AUTH_TOKEN')
    expect(out).not.toContain('SENTINEL_COOKIE')
    expect(out).not.toContain('SENTINEL_SETCOOKIE')
  })

  // End-to-end: a real request carrying secret headers. They don't appear because default
  // serializers don't log headers — this guards against a future serializer change leaking them.
  it('keeps authorization/cookie headers off the request log lines', async () => {
    const { lines, stream } = capture()
    const app = buildApp(openDb(':memory:'), { log: true, logStream: stream })
    await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { authorization: 'Bearer SENTINEL_AUTH', cookie: 'session=SENTINEL_C' },
    })
    const out = lines.join('')
    expect(out).toContain('"url":"/api/health"') // the request was logged
    expect(out).not.toContain('SENTINEL_AUTH')
    expect(out).not.toContain('SENTINEL_C')
  })
})

describe('CAPACITYLENS_LOG invite-token URL redaction (P1.9)', () => {
  // The invite-accept URL carries the bearer token in its PATH; pino logs req.url verbatim, so a
  // serializer must mask the :token segment before it reaches stdout. Other URLs stay intact.
  it('rewrites /api/invites/<token>/accept to /api/invites/[redacted]/accept', async () => {
    const { lines, stream } = capture()
    const app = buildApp(openDb(':memory:'), { log: true, logStream: stream })
    const TOKEN = 'SENTINEL_LIVE_INVITE_TOKEN'
    // The token is unknown → the route 404s, but the request IS logged with the URL we care about.
    const res = await app.inject({ method: 'POST', url: `/api/invites/${TOKEN}/accept`, payload: {} })
    expect(res.statusCode).toBe(404)
    const out = lines.join('')
    expect(out).toContain('"url":"/api/invites/[redacted]/accept"') // masked path logged
    expect(out).not.toContain(TOKEN) // the live token never reaches the log
  })

  it.each(['preview', 'signup'])('also redacts the token from the %s URL', async (operation) => {
    const { lines, stream } = capture()
    const app = buildApp(openDb(':memory:'), { log: true, logStream: stream })
    const TOKEN = `SENTINEL_${operation.toUpperCase()}_INVITE_TOKEN`
    await app.inject({
      method: operation === 'preview' ? 'GET' : 'POST',
      url: `/api/invites/${TOKEN}/${operation}`,
      ...(operation === 'signup' ? { payload: {} } : {}),
    })
    const out = lines.join('')
    expect(out).toContain(`"url":"/api/invites/[redacted]/${operation}"`)
    expect(out).not.toContain(TOKEN)
  })

  it('also redacts token paths in structured security events', async () => {
    const db = openDb(':memory:')
    const { mode, auth } = authFromEnv(db, PASSWORD_ENV)
    await runAuthMigrations(auth!)
    const events: Array<Record<string, unknown>> = []
    const app = buildApp(db, { authMode: mode, auth, securityLog: (event) => events.push(event) })
    const TOKEN = 'SENTINEL_SECURITY_EVENT_INVITE_TOKEN'

    const res = await app.inject({ method: 'POST', url: `/api/invites/${TOKEN}/accept` })
    expect(res.statusCode).toBe(401)
    expect(events).toContainEqual(expect.objectContaining({
      event: 'authentication_required',
      path: '/api/invites/[redacted]/accept',
    }))
    expect(JSON.stringify(events)).not.toContain(TOKEN)
  })

  it('leaves every other URL intact', async () => {
    const { lines, stream } = capture()
    const app = buildApp(openDb(':memory:'), { log: true, logStream: stream })
    await app.inject({ method: 'GET', url: '/api/health' })
    expect(lines.join('')).toContain('"url":"/api/health"')
  })
})

describe('CAPACITYLENS_LOG off (default)', () => {
  it('emits no request logs at all', async () => {
    const { lines, stream } = capture()
    const app = buildApp(openDb(':memory:'), { logStream: stream }) // stream ignored when off
    await app.inject({ method: 'GET', url: '/api/health' })
    expect(lines).toEqual([])
  })

  it('keeps the 500-path on console.error (today, byte for byte)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { lines, stream } = capture()
    const db = openDb(':memory:')
    const app = buildApp(db, { logStream: stream })
    db.close()
    const res = await app.inject({ method: 'GET', url: '/api/state' })
    expect(res.statusCode).toBe(500)
    expect(consoleError).toHaveBeenCalled()
    expect(lines).toEqual([])
  })
})
