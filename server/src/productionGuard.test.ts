import { describe, it, expect } from 'vitest'
import { evaluateProductionPosture } from './productionGuard'

// P3.1: once NODE_ENV=production, the dev/open posture is retired — the entrypoint refuses to
// boot when auth is OFF (unless deliberately opted in) and warns on the softer posture concerns.
// Outside production it is a strict no-op so dev / e2e / self-host are untouched. These tests
// prove BOTH directions (it actually refuses, and a clean production config passes clean).

describe('evaluateProductionPosture', () => {
  it('is a no-op outside production, even with the worst-looking env (dev/self-host untouched)', () => {
    // CAPACITYLENS_AUTH unset (off), CAPACITYLENS_HTTPS unset, open signup on — none of which may
    // produce a refusal OR a warning unless NODE_ENV is explicitly 'production'.
    const worst = {
      CAPACITYLENS_AUTH: undefined,
      CAPACITYLENS_HTTPS: undefined,
      CAPACITYLENS_ALLOW_OPEN_SIGNUP: '1',
    }
    for (const NODE_ENV of [undefined, 'development', 'test']) {
      const result = evaluateProductionPosture({ ...worst, NODE_ENV })
      expect(result.refusals).toEqual([])
      expect(result.warnings).toEqual([])
    }
  })

  it('refuses boot when auth is OFF in production (auth unset)', () => {
    const result = evaluateProductionPosture({ NODE_ENV: 'production', CAPACITYLENS_AUTH: undefined })
    expect(result.refusals).toHaveLength(1)
    // The single refusal must name the auth env var / mode so the operator knows what to change.
    expect(result.refusals[0]).toMatch(/CAPACITYLENS_AUTH/)
    expect(result.refusals[0]).toMatch(/auth is OFF/)
    // HTTPS unset here, so a warning is expected — the refusal does not suppress warnings.
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('downgrades the auth-off refusal to a warning when CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION=1', () => {
    const result = evaluateProductionPosture({
      NODE_ENV: 'production',
      CAPACITYLENS_AUTH: 'off',
      CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION: '1',
    })
    expect(result.refusals).toEqual([])
    // The deliberate-open note must still surface (never silenced), naming the opt-in var.
    expect(
      result.warnings.some((w) => /CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION/.test(w) && /open\/demo/.test(w)),
    ).toBe(true)
  })

  it('warns (does not refuse) on HTTPS/HSTS off in production with auth on', () => {
    const result = evaluateProductionPosture({
      NODE_ENV: 'production',
      CAPACITYLENS_AUTH: 'password',
      CAPACITYLENS_HTTPS: undefined,
    })
    expect(result.refusals).toEqual([])
    expect(result.warnings.some((w) => /CAPACITYLENS_HTTPS/.test(w) && /HSTS/.test(w))).toBe(true)
  })

  it('is fully clean (no refusals, no warnings) for a well-formed production posture — positive control', () => {
    const result = evaluateProductionPosture({
      NODE_ENV: 'production',
      CAPACITYLENS_AUTH: 'password',
      CAPACITYLENS_HTTPS: '1',
    })
    expect(result.refusals).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('warns on open self-registration in production (sso + https, signup open)', () => {
    const result = evaluateProductionPosture({
      NODE_ENV: 'production',
      CAPACITYLENS_AUTH: 'sso',
      CAPACITYLENS_HTTPS: '1',
      CAPACITYLENS_ALLOW_OPEN_SIGNUP: '1',
    })
    expect(result.refusals).toEqual([])
    expect(result.warnings.some((w) => /CAPACITYLENS_ALLOW_OPEN_SIGNUP/.test(w))).toBe(true)
  })
})
