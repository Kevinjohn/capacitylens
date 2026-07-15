import { describe, it, expect } from 'vitest'
import { evaluateProductionPosture } from './productionGuard'
import { BOOTSTRAP_ADMIN_EMAIL } from './auth'

type ProductionEnv = Parameters<typeof evaluateProductionPosture>[0]

const REQUIRED_PRODUCTION_CONTROLS: ProductionEnv = {
  NODE_ENV: 'production',
  CAPACITYLENS_HTTPS: '1',
  CAPACITYLENS_REQUIRE_MFA: '1',
  CAPACITYLENS_SSO_MFA_ENFORCED: '1',
  CAPACITYLENS_RATE_LIMIT: '240',
  CAPACITYLENS_AUDIT: 'on',
  CAPACITYLENS_AUDIT_STDOUT: '1',
  CAPACITYLENS_STORAGE_ENCRYPTED: '1',
  CAPACITYLENS_SECURITY_LOG_FORWARDING: '1',
  CAPACITYLENS_INTERNAL_TLS_CERT: '/run/capacitylens-internal-tls/api.crt',
  CAPACITYLENS_INTERNAL_TLS_KEY: '/run/capacitylens-internal-tls/api.key',
}

function productionPosture(overrides: ProductionEnv) {
  return evaluateProductionPosture({ ...REQUIRED_PRODUCTION_CONTROLS, ...overrides })
}

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
    const result = productionPosture({ CAPACITYLENS_AUTH: undefined, CAPACITYLENS_HTTPS: undefined })
    expect(result.refusals).toHaveLength(1)
    // The single refusal must name the auth env var / mode so the operator knows what to change.
    expect(result.refusals[0]).toMatch(/CAPACITYLENS_AUTH/)
    expect(result.refusals[0]).toMatch(/auth is OFF/)
    // HTTPS unset here, so a warning is expected — the refusal does not suppress warnings.
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('downgrades the auth-off refusal to a warning when CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION=1', () => {
    const result = productionPosture({
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
    const result = productionPosture({
      CAPACITYLENS_AUTH: 'password',
      CAPACITYLENS_HTTPS: undefined,
    })
    expect(result.refusals).toEqual([])
    expect(result.warnings.some((w) => /CAPACITYLENS_HTTPS/.test(w) && /HSTS/.test(w))).toBe(true)
  })

  it('is fully clean (no refusals, no warnings) for a well-formed production posture — positive control', () => {
    const result = productionPosture({
      CAPACITYLENS_AUTH: 'password',
      CAPACITYLENS_HTTPS: '1',
    })
    expect(result.refusals).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('warns on open self-registration in production (sso + https, signup open)', () => {
    const result = productionPosture({
      CAPACITYLENS_AUTH: 'sso',
      CAPACITYLENS_HTTPS: '1',
      CAPACITYLENS_ALLOW_OPEN_SIGNUP: '1',
    })
    expect(result.refusals).toEqual([])
    expect(result.warnings.some((w) => /CAPACITYLENS_ALLOW_OPEN_SIGNUP/.test(w))).toBe(true)
  })

  it('refuses the development-only bootstrap-owner flag in production', () => {
    // The entrypoint folds the --create-owner-admin-admin argv spelling into this env form before
    // calling here, so this single check covers BOTH spellings of the flag.
    const result = productionPosture({
      CAPACITYLENS_AUTH: 'password',
      CAPACITYLENS_HTTPS: '1',
      CAPACITYLENS_CREATE_ADMIN_ADMIN: '1',
    })
    expect(result.refusals).toHaveLength(1)
    // The refusal must name the exact credential so the operator knows what to change — asserted
    // via the auth.ts exports, so a credential change can't leave this test passing on stale text.
    expect(
      result.refusals.some(
        (w) => w.includes(BOOTSTRAP_ADMIN_EMAIL) && /expire after first use/.test(w) && /CAPACITYLENS_CREATE_ADMIN_ADMIN/.test(w),
      ),
    ).toBe(true)
    // And it stays a no-op outside production, like every other posture concern.
    expect(
      evaluateProductionPosture({ NODE_ENV: 'test', CAPACITYLENS_CREATE_ADMIN_ADMIN: '1' }).warnings,
    ).toEqual([])
  })

  it('refuses a pinned bootstrap-owner password in production', () => {
    const result = productionPosture({
      CAPACITYLENS_AUTH: 'password',
      CAPACITYLENS_HTTPS: '1',
      CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD: 'operator-chosen-pw',
    })
    expect(result.refusals).toHaveLength(1)
    // Names the exact credential (from the auth.ts export) and the env, so the operator knows what to
    // change; the pinned SECRET itself must never be echoed back into the refusal text.
    expect(
      result.refusals.some(
        (w) =>
          w.includes(BOOTSTRAP_ADMIN_EMAIL) &&
          /CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD/.test(w) &&
          !w.includes('operator-chosen-pw'),
      ),
    ).toBe(true)
    // No-op outside production, like every other posture concern.
    expect(
      evaluateProductionPosture({ NODE_ENV: 'test', CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD: 'x' }).warnings,
    ).toEqual([])
  })

  it.each([
    ['MFA', { CAPACITYLENS_AUTH: 'password', CAPACITYLENS_REQUIRE_MFA: undefined }],
    ['breach checking', { CAPACITYLENS_AUTH: 'password', CAPACITYLENS_PASSWORD_BREACH_CHECK: 'off' }],
    ['SSO MFA assurance', { CAPACITYLENS_AUTH: 'sso', CAPACITYLENS_SSO_MFA_ENFORCED: undefined }],
    ['rate limiting', { CAPACITYLENS_AUTH: 'sso', CAPACITYLENS_RATE_LIMIT: '0' }],
    ['audit logging', { CAPACITYLENS_AUTH: 'sso', CAPACITYLENS_AUDIT: 'off' }],
    ['audit forwarding output', { CAPACITYLENS_AUTH: 'sso', CAPACITYLENS_AUDIT_STDOUT: undefined }],
    ['encrypted storage', { CAPACITYLENS_AUTH: 'sso', CAPACITYLENS_STORAGE_ENCRYPTED: undefined }],
    ['central security-log forwarding', { CAPACITYLENS_AUTH: 'sso', CAPACITYLENS_SECURITY_LOG_FORWARDING: undefined }],
    ['internal service TLS', { CAPACITYLENS_AUTH: 'sso', CAPACITYLENS_INTERNAL_TLS_CERT: undefined }],
  ])('refuses a production deployment that has no %s control', (_control, overrides) => {
    const result = productionPosture(overrides)
    expect(result.refusals).toHaveLength(1)
  })
})
