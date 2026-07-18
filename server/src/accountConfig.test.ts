import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  accountConfigKey,
  AccountConfigError,
  resetAccountConfigWarningStateForTests,
  resolveAccountEnvironment,
} from './accountConfig'

const hosted = {
  SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE: 'hosted-oidc-only',
  SMALLSASS_ACCOUNT_MODE: 'sso',
  SMALLSASS_ACCOUNT_OIDC_CLIENT_ID: 'client-id',
  SMALLSASS_ACCOUNT_OIDC_CLIENT_SECRET: 'client-secret',
  SMALLSASS_ACCOUNT_OIDC_DISCOVERY_URL: 'https://idp.example/.well-known/openid-configuration',
  SMALLSASS_ACCOUNT_OIDC_ISSUER: 'https://idp.example',
}

describe('neutral account configuration', () => {
  beforeEach(() => resetAccountConfigWarningStateForTests())

  it('keeps adapter compatibility keys out of operator-facing configuration errors', () => {
    expect(accountConfigKey('BETTER_AUTH_SECRET')).toBe('SMALLSASS_ACCOUNT_SECRET')
    expect(accountConfigKey('CAPACITYLENS_SSO_DISCOVERY_URL'))
      .toBe('SMALLSASS_ACCOUNT_OIDC_DISCOVERY_URL')
    expect(accountConfigKey('CAPACITYLENS_RATE_LIMIT')).toBe('CAPACITYLENS_RATE_LIMIT')
  })

  it('maps canonical names onto the compatibility environment without a warning', () => {
    const warn = vi.fn()
    const resolved = resolveAccountEnvironment({
      SMALLSASS_ACCOUNT_MODE: 'password',
      SMALLSASS_ACCOUNT_SECRET: 'x'.repeat(32),
    }, { warn })
    expect(resolved.env.CAPACITYLENS_AUTH).toBe('password')
    expect(resolved.env.BETTER_AUTH_SECRET).toBe('x'.repeat(32))
    expect(warn).not.toHaveBeenCalled()
  })

  it('accepts a legacy alias for the compatibility window and warns once without values', () => {
    const warn = vi.fn()
    const source = { CAPACITYLENS_AUTH: 'password' }
    resolveAccountEnvironment(source, { warn })
    resolveAccountEnvironment(source, { warn })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('CAPACITYLENS_AUTH')
    expect(warn.mock.calls[0]?.[0]).toContain('SMALLSASS_ACCOUNT_MODE')
    expect(warn.mock.calls[0]?.[0]).not.toContain('password')
  })

  it('does not reinterpret generated compatibility aliases when a resolved environment is reused', () => {
    const warn = vi.fn()
    const first = resolveAccountEnvironment({
      SMALLSASS_ACCOUNT_MODE: 'off',
    }, { warn })
    const second = resolveAccountEnvironment(first.env, { warn })

    expect(second.env).toBe(first.env)
    expect(second.profile).toBe(first.profile)
    expect(warn).not.toHaveBeenCalled()
  })

  it('accepts normalized-identical aliases and refuses conflicts', () => {
    const normalized = resolveAccountEnvironment({
      SMALLSASS_ACCOUNT_MODE: ' password ',
      CAPACITYLENS_AUTH: 'password',
      SMALLSASS_ACCOUNT_OIDC_SCOPES: ' openid   profile  email ',
    }, { warn: () => {} })
    expect(normalized.env.CAPACITYLENS_AUTH).toBe('password')
    expect(normalized.env.CAPACITYLENS_SSO_SCOPES).toBe('openid profile email')
    expect(() => resolveAccountEnvironment({
      SMALLSASS_ACCOUNT_MODE: 'sso',
      CAPACITYLENS_AUTH: 'password',
    }, { warn: () => {} })).toThrow(AccountConfigError)
  })

  it('treats empty Compose placeholders as absent', () => {
    const warn = vi.fn()
    const resolved = resolveAccountEnvironment({
      SMALLSASS_ACCOUNT_MODE: '',
      CAPACITYLENS_AUTH: 'password',
      SMALLSASS_ACCOUNT_SECRET: '   ',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
    }, { warn })
    expect(resolved.env.CAPACITYLENS_AUTH).toBe('password')
    expect(resolved.env.BETTER_AUTH_SECRET).toBe('x'.repeat(32))
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('enforces hosted OIDC-only and accepts a strict discovery configuration', () => {
    const resolved = resolveAccountEnvironment(hosted, { warn: () => {} })
    expect(resolved.profile).toBe('hosted-oidc-only')
    expect(resolved.env.CAPACITYLENS_AUTH).toBe('sso')
    expect(() => resolveAccountEnvironment({
      ...hosted,
      SMALLSASS_ACCOUNT_MODE: 'password',
    }, { warn: () => {} })).toThrow(/hosted password accounts are prohibited/i)
    expect(() => resolveAccountEnvironment({
      ...hosted,
      SMALLSASS_ACCOUNT_OIDC_DISCOVERY_URL: undefined,
    }, { warn: () => {} })).toThrow(/discovery/i)
    expect(() => resolveAccountEnvironment({
      ...hosted,
      SMALLSASS_ACCOUNT_ALLOW_OPEN_SIGNUP: '1',
    }, { warn: () => {} })).toThrow(/open signup/i)
    expect(() => resolveAccountEnvironment({
      ...hosted,
      SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID: 'google',
    }, { warn: () => {} })).toThrow(/strict OIDC provider/i)
    expect(() => resolveAccountEnvironment({
      ...hosted,
      SMALLSASS_ACCOUNT_MICROSOFT_TENANT_ID: 'tenant-only',
    }, { warn: () => {} })).toThrow(/strict OIDC provider/i)
    expect(() => resolveAccountEnvironment({
      ...hosted,
      SMALLSASS_ACCOUNT_SETUP_TOKEN: 'password-setup',
    }, { warn: () => {} })).toThrow(/password-account configuration/i)
    expect(() => resolveAccountEnvironment({
      ...hosted,
      SMALLSASS_ACCOUNT_OIDC_AUTHORIZATION_URL: 'https://idp.example/authorize',
    }, { warn: () => {} })).toThrow(/endpoint overrides/i)
  })

  it('requires strict OIDC material for mixed and SSO-only named profiles', () => {
    expect(() => resolveAccountEnvironment({
      SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE: 'self-hosted-mixed',
      SMALLSASS_ACCOUNT_MODE: 'password',
    }, { warn: () => {} })).toThrow(/strict OIDC/i)
    expect(() => resolveAccountEnvironment({
      ...hosted,
      SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE: 'self-hosted-mixed',
      SMALLSASS_ACCOUNT_MODE: 'password',
    }, { warn: () => {} })).not.toThrow()
    expect(() => resolveAccountEnvironment({
      ...hosted,
      SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE: 'self-hosted-sso-only',
    }, { warn: () => {} })).not.toThrow()
  })

  it('refuses external provider configuration in the password-only profile', () => {
    expect(() => resolveAccountEnvironment({
      SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE: 'self-hosted-password',
      SMALLSASS_ACCOUNT_MODE: 'password',
      SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID: 'google-client',
      SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET: 'google-secret',
    }, { warn: () => {} })).toThrow(/does not permit external identity providers/i)
    expect(() => resolveAccountEnvironment({
      SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE: 'self-hosted-password',
      SMALLSASS_ACCOUNT_MODE: 'password',
      SMALLSASS_ACCOUNT_OIDC_CLIENT_ID: 'client-id',
      SMALLSASS_ACCOUNT_OIDC_CLIENT_SECRET: 'client-secret',
    }, { warn: () => {} })).toThrow(/does not permit external identity providers/i)
    expect(() => resolveAccountEnvironment({
      SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE: 'self-hosted-password',
      SMALLSASS_ACCOUNT_MODE: 'password',
      SMALLSASS_ACCOUNT_OIDC_LABEL: 'unused-but-misleading',
    }, { warn: () => {} })).toThrow(/does not permit external identity providers/i)
  })
})
