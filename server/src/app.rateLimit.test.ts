import { describe, it, expect } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp, parseRateLimit } from './app'
import { openDb } from './db'

// P1.5 (flag CAPACITYLENS_RATE_LIMIT → opts.rateLimit): a guard against accidental client
// loops hammering the single-writer SQLite file. OFF (the default) means the plugin is
// not registered at all; /api/health is always exempt so the uptime monitor never sees
// a 429. The env parse is fail-closed: only a positive integer turns it on.

const health = (app: FastifyInstance, headers?: Record<string, string>) =>
  app.inject({ method: 'GET', url: '/api/health', headers })
const stateReq = (app: FastifyInstance, headers?: Record<string, string>) =>
  app.inject({ method: 'GET', url: '/api/state', headers })

describe('parseRateLimit (fail-closed)', () => {
  it('accepts only a positive integer', () => {
    expect(parseRateLimit('300')).toBe(300)
    expect(parseRateLimit('1')).toBe(1)
    expect(parseRateLimit('0')).toBe(0)
    expect(parseRateLimit('-5')).toBe(0)
    expect(parseRateLimit('12.5')).toBe(0)
    expect(parseRateLimit('lots')).toBe(0)
    expect(parseRateLimit('')).toBe(0)
    expect(parseRateLimit(undefined)).toBe(0)
  })
})

describe('CAPACITYLENS_RATE_LIMIT on', () => {
  it('429s the third request inside a minute with a JSON error', async () => {
    const app = buildApp(openDb(':memory:'), { rateLimit: 2 })
    expect((await stateReq(app)).statusCode).toBe(200)
    expect((await stateReq(app)).statusCode).toBe(200)
    const third = await stateReq(app)
    expect(third.statusCode).toBe(429)
    expect(typeof third.json().error).toBe('string') // the API's usual { error } shape
  })

  it('never 429s /api/health', async () => {
    const app = buildApp(openDb(':memory:'), { rateLimit: 2 })
    for (let i = 0; i < 5; i++) expect((await health(app)).statusCode).toBe(200)
  })

  it('keys on X-Forwarded-For only when told the host is behind the proxy', async () => {
    // Behind the proxy: distinct forwarded clients get their own buckets.
    const proxied = buildApp(openDb(':memory:'), { rateLimit: 2, rateLimitTrustForwarded: true })
    for (const ip of ['10.0.0.1', '10.0.0.2', '10.0.0.3']) {
      expect((await stateReq(proxied, { 'x-forwarded-for': ip })).statusCode).toBe(200)
    }
    // Directly exposed: the spoofable header is ignored — all three share the socket's key.
    const exposed = buildApp(openDb(':memory:'), { rateLimit: 2 })
    expect((await stateReq(exposed, { 'x-forwarded-for': '10.0.0.1' })).statusCode).toBe(200)
    expect((await stateReq(exposed, { 'x-forwarded-for': '10.0.0.2' })).statusCode).toBe(200)
    expect((await stateReq(exposed, { 'x-forwarded-for': '10.0.0.3' })).statusCode).toBe(429)
  })
})

describe('CAPACITYLENS_RATE_LIMIT off (default)', () => {
  it('no 429 under burst — the plugin is not registered', async () => {
    const app = buildApp(openDb(':memory:'))
    for (let i = 0; i < 10; i++) expect((await stateReq(app)).statusCode).toBe(200)
  })
})
