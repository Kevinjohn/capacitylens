import { describe, it, expect } from 'vitest'
import { resetForbidden } from './bootGuard'

// P1.6: the destructive test-only reset route must be impossible in production. The
// entrypoint refuses to boot on this predicate; everything else is unaffected.

describe('resetForbidden', () => {
  it('forbids boot only when reset is enabled IN production', () => {
    expect(resetForbidden({ CAPACITYLENS_ALLOW_RESET: '1', NODE_ENV: 'production' })).toBe(true)
  })

  it('allows every other combination (dev and e2e stay untouched)', () => {
    expect(resetForbidden({ CAPACITYLENS_ALLOW_RESET: '1', NODE_ENV: 'development' })).toBe(false)
    expect(resetForbidden({ CAPACITYLENS_ALLOW_RESET: '1', NODE_ENV: 'test' })).toBe(false)
    expect(resetForbidden({ CAPACITYLENS_ALLOW_RESET: '1' })).toBe(false)
    expect(resetForbidden({ NODE_ENV: 'production' })).toBe(false)
    expect(resetForbidden({ CAPACITYLENS_ALLOW_RESET: '0', NODE_ENV: 'production' })).toBe(false)
    expect(resetForbidden({})).toBe(false)
  })
})
