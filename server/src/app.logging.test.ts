import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildApp } from './app'
import { openDb } from './db'

// P1.3 (flag FLOATY_LOG → opts.log): ON gives structured per-request JSON via Fastify's
// bundled pino and routes the 500-path error through the request logger; OFF is byte-for-
// byte today's behaviour (no request logs, bare console.error on 500s). The logStream
// seam exists only so these tests can read the JSON lines instead of stdout.

function capture() {
  const lines: string[] = []
  return { lines, stream: { write: (msg: string) => void lines.push(msg) } }
}

afterEach(() => vi.restoreAllMocks())

describe('FLOATY_LOG on', () => {
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

describe('FLOATY_LOG off (default)', () => {
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
