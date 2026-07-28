import { describe, expect, it } from 'vitest'
import { legacyProxyTrustWarning, trustProxyHeadersFrom } from './proxyTrust'

describe('proxy-header trust posture', () => {
  it.each(['127.0.0.1', 'localhost', '::1'])('trusts the local proxy hop on %s', (host) => {
    expect(trustProxyHeadersFrom({}, host)).toBe(true)
  })

  it('requires the canonical opt-in on a directly exposed host', () => {
    expect(trustProxyHeadersFrom({}, '0.0.0.0')).toBe(false)
    expect(trustProxyHeadersFrom({ CAPACITYLENS_TRUST_PROXY_HEADERS: '1' }, '0.0.0.0')).toBe(true)
    expect(trustProxyHeadersFrom({ CAPACITYLENS_TRUST_PROXY_HEADERS: '0' }, '0.0.0.0')).toBe(false)
  })

  it('honours the legacy key only when the canonical posture is absent', () => {
    const legacy = { CAPACITYLENS_RATE_LIMIT_TRUST_FORWARDED: '1' }
    expect(trustProxyHeadersFrom(legacy, '0.0.0.0')).toBe(true)
    expect(legacyProxyTrustWarning(legacy)).toMatch(/deprecated.*X-Forwarded-For.*X-Forwarded-Proto/)

    const canonicalWins = {
      ...legacy,
      CAPACITYLENS_TRUST_PROXY_HEADERS: '0',
    }
    expect(trustProxyHeadersFrom(canonicalWins, '0.0.0.0')).toBe(false)
    expect(legacyProxyTrustWarning(canonicalWins)).toBeNull()
  })
})
