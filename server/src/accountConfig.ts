import {
  isAccountDeploymentProfile,
  type AccountDeploymentProfile,
} from '@capacitylens/shared/account/conformance'

export type { AccountDeploymentProfile } from '@capacitylens/shared/account/conformance'

export class AccountConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AccountConfigError'
  }
}

const ALIASES = {
  SMALLSASS_ACCOUNT_MODE: 'CAPACITYLENS_AUTH',
  SMALLSASS_ACCOUNT_SECRET: 'BETTER_AUTH_SECRET',
  SMALLSASS_ACCOUNT_PUBLIC_URL: 'BETTER_AUTH_URL',
  SMALLSASS_ACCOUNT_SETUP_TOKEN: 'CAPACITYLENS_SETUP_TOKEN',
  SMALLSASS_ACCOUNT_ALLOW_OPEN_SIGNUP: 'CAPACITYLENS_ALLOW_OPEN_SIGNUP',
  SMALLSASS_ACCOUNT_REQUIRE_MFA: 'CAPACITYLENS_REQUIRE_MFA',
  SMALLSASS_ACCOUNT_PASSWORD_BREACH_CHECK: 'CAPACITYLENS_PASSWORD_BREACH_CHECK',
  SMALLSASS_ACCOUNT_SSO_MFA_ENFORCED: 'CAPACITYLENS_SSO_MFA_ENFORCED',
  SMALLSASS_ACCOUNT_OIDC_CLIENT_ID: 'CAPACITYLENS_SSO_CLIENT_ID',
  SMALLSASS_ACCOUNT_OIDC_CLIENT_SECRET: 'CAPACITYLENS_SSO_CLIENT_SECRET',
  SMALLSASS_ACCOUNT_OIDC_DISCOVERY_URL: 'CAPACITYLENS_SSO_DISCOVERY_URL',
  SMALLSASS_ACCOUNT_OIDC_ISSUER: 'CAPACITYLENS_SSO_ISSUER',
  SMALLSASS_ACCOUNT_OIDC_AUTHORIZATION_URL: 'CAPACITYLENS_SSO_AUTHORIZATION_URL',
  SMALLSASS_ACCOUNT_OIDC_TOKEN_URL: 'CAPACITYLENS_SSO_TOKEN_URL',
  SMALLSASS_ACCOUNT_OIDC_SCOPES: 'CAPACITYLENS_SSO_SCOPES',
  SMALLSASS_ACCOUNT_OIDC_PROVIDER_ID: 'CAPACITYLENS_SSO_PROVIDER_ID',
  SMALLSASS_ACCOUNT_OIDC_LABEL: 'CAPACITYLENS_SSO_LABEL',
  SMALLSASS_ACCOUNT_OIDC_BOOTSTRAP_EMAILS: 'CAPACITYLENS_SSO_BOOTSTRAP_EMAILS',
  SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID: 'CAPACITYLENS_GOOGLE_CLIENT_ID',
  SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET: 'CAPACITYLENS_GOOGLE_CLIENT_SECRET',
  SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_ID: 'CAPACITYLENS_MICROSOFT_CLIENT_ID',
  SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_SECRET: 'CAPACITYLENS_MICROSOFT_CLIENT_SECRET',
  SMALLSASS_ACCOUNT_MICROSOFT_TENANT_ID: 'CAPACITYLENS_MICROSOFT_TENANT_ID',
  SMALLSASS_ACCOUNT_GITHUB_CLIENT_ID: 'CAPACITYLENS_GITHUB_CLIENT_ID',
  SMALLSASS_ACCOUNT_GITHUB_CLIENT_SECRET: 'CAPACITYLENS_GITHUB_CLIENT_SECRET',
} as const

const CANONICAL_BY_COMPATIBILITY_KEY = new Map<string, string>(
  Object.entries(ALIASES).map(([canonical, compatibility]) => [compatibility, canonical]),
)

/** Operator-facing name for an account setting consumed through the compatibility adapter. */
export function accountConfigKey(key: string): string {
  return CANONICAL_BY_COMPATIBILITY_KEY.get(key) ?? key
}

const SECRET_KEYS = new Set<string>([
  'SMALLSASS_ACCOUNT_SECRET',
  'SMALLSASS_ACCOUNT_SETUP_TOKEN',
  'SMALLSASS_ACCOUNT_OIDC_CLIENT_SECRET',
  'SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET',
  'SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_SECRET',
  'SMALLSASS_ACCOUNT_GITHUB_CLIENT_SECRET',
])

const warnedAliases = new Set<string>()
const resolvedAccountEnvironments = new WeakMap<object, AccountDeploymentProfile | null>()

function normalizedForComparison(key: string, value: string): string {
  if (SECRET_KEYS.has(key)) return value
  if (key === 'SMALLSASS_ACCOUNT_MODE') return value.trim().toLowerCase()
  if (key === 'SMALLSASS_ACCOUNT_OIDC_SCOPES') return value.trim().split(/\s+/).join(' ')
  return value.trim()
}

function configured(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value
}

function resolvedValue(key: string, value: string): string {
  if (key === 'SMALLSASS_ACCOUNT_MODE') return value.trim().toLowerCase()
  if (key === 'SMALLSASS_ACCOUNT_OIDC_SCOPES') return value.trim().split(/\s+/).join(' ')
  return value
}

export interface ResolvedAccountEnvironment {
  env: Record<string, string | undefined>
  profile: AccountDeploymentProfile | null
}

/** Resolve canonical family configuration and legacy aliases exactly once at composition time. */
export function resolveAccountEnvironment(
  source: Record<string, string | undefined>,
  options: { warn?: (message: string) => void } = {},
): ResolvedAccountEnvironment {
  // Startup resolves the family namespace before it opens storage, then passes that exact object
  // into the auth adapter. Keep resolution idempotent so the adapter can also safely accept raw
  // environments in tests and embedded callers without reinterpreting generated compatibility
  // aliases as operator-supplied deprecated settings.
  if (resolvedAccountEnvironments.has(source)) {
    return { env: source, profile: resolvedAccountEnvironments.get(source) ?? null }
  }
  const env = { ...source }
  const warn = options.warn ?? ((message: string) => {
    if (source.NODE_ENV !== 'test') console.warn(message)
  })
  for (const [canonical, legacy] of Object.entries(ALIASES)) {
    // Compose commonly materializes unset interpolation as an empty string. Treat that as absent
    // so an empty canonical placeholder cannot conflict with (or erase) a real compatibility
    // alias supplied by an existing deployment.
    const canonicalValue = configured(source[canonical])
    const legacyValue = configured(source[legacy])
    if (canonicalValue !== undefined && legacyValue !== undefined) {
      if (normalizedForComparison(canonical, canonicalValue) !== normalizedForComparison(canonical, legacyValue)) {
        throw new AccountConfigError(
          `${canonical} conflicts with its legacy alias ${legacy}; refusing to choose a security posture.`,
        )
      }
      if (!warnedAliases.has(legacy)) {
        warn(`account configuration: ${legacy} is deprecated; use ${canonical}.`)
        warnedAliases.add(legacy)
      }
      env[canonical] = resolvedValue(canonical, canonicalValue)
      env[legacy] = env[canonical]
    } else if (canonicalValue !== undefined) {
      env[canonical] = resolvedValue(canonical, canonicalValue)
      env[legacy] = env[canonical]
    } else if (legacyValue !== undefined) {
      if (!warnedAliases.has(legacy)) {
        warn(`account configuration: ${legacy} is deprecated; use ${canonical}.`)
        warnedAliases.add(legacy)
      }
      env[canonical] = resolvedValue(canonical, legacyValue)
      env[legacy] = env[canonical]
    } else {
      delete env[canonical]
      delete env[legacy]
    }
  }

  const rawProfile = source.SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE?.trim()
  const profile = rawProfile === undefined || rawProfile === '' ? null : rawProfile
  if (
    profile !== null &&
    !isAccountDeploymentProfile(profile)
  ) {
    throw new AccountConfigError(
      'SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE must be self-hosted-password, self-hosted-mixed, self-hosted-sso-only, or hosted-oidc-only.',
    )
  }

  if (profile === 'hosted-oidc-only') {
    if (env.CAPACITYLENS_AUTH !== 'sso') {
      throw new AccountConfigError(
        'The hosted-oidc-only deployment profile requires SMALLSASS_ACCOUNT_MODE=sso; hosted password accounts are prohibited.',
      )
    }
    if (!env.CAPACITYLENS_SSO_CLIENT_ID || !env.CAPACITYLENS_SSO_CLIENT_SECRET) {
      throw new AccountConfigError('The hosted-oidc-only deployment profile requires an OIDC client id and secret.')
    }
    if (!env.CAPACITYLENS_SSO_DISCOVERY_URL || !env.CAPACITYLENS_SSO_ISSUER) {
      throw new AccountConfigError('The hosted-oidc-only deployment profile requires an explicit OIDC issuer and discovery metadata.')
    }
    const scopes = (env.CAPACITYLENS_SSO_SCOPES ?? 'openid profile email').split(/\s+/)
    if (!scopes.includes('openid')) {
      throw new AccountConfigError('The hosted-oidc-only deployment profile requires the openid scope.')
    }
    if (
      env.CAPACITYLENS_GOOGLE_CLIENT_ID ||
      env.CAPACITYLENS_GOOGLE_CLIENT_SECRET ||
      env.CAPACITYLENS_MICROSOFT_CLIENT_ID ||
      env.CAPACITYLENS_MICROSOFT_CLIENT_SECRET ||
      env.CAPACITYLENS_MICROSOFT_TENANT_ID ||
      env.CAPACITYLENS_GITHUB_CLIENT_ID ||
      env.CAPACITYLENS_GITHUB_CLIENT_SECRET
    ) {
      throw new AccountConfigError(
        'The hosted-oidc-only deployment profile accepts only the configured strict OIDC provider.',
      )
    }
    if (env.CAPACITYLENS_ALLOW_OPEN_SIGNUP === '1') {
      throw new AccountConfigError('The hosted-oidc-only deployment profile forbids open signup.')
    }
    if (
      env.CAPACITYLENS_SETUP_TOKEN ||
      env.CAPACITYLENS_REQUIRE_MFA ||
      env.CAPACITYLENS_PASSWORD_BREACH_CHECK ||
      source.CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD ||
      source.CAPACITYLENS_CREATE_ADMIN_ADMIN === '1'
    ) {
      throw new AccountConfigError('The hosted-oidc-only deployment profile refuses password-account configuration.')
    }
  }
  if (profile === 'self-hosted-password' && env.CAPACITYLENS_AUTH !== 'password') {
    throw new AccountConfigError('The self-hosted-password profile requires SMALLSASS_ACCOUNT_MODE=password.')
  }
  if (
    profile === 'self-hosted-password' &&
    (
      env.CAPACITYLENS_SSO_CLIENT_ID ||
      env.CAPACITYLENS_SSO_CLIENT_SECRET ||
      env.CAPACITYLENS_SSO_DISCOVERY_URL ||
      env.CAPACITYLENS_SSO_ISSUER ||
      env.CAPACITYLENS_SSO_AUTHORIZATION_URL ||
      env.CAPACITYLENS_SSO_TOKEN_URL ||
      env.CAPACITYLENS_SSO_SCOPES ||
      env.CAPACITYLENS_SSO_PROVIDER_ID ||
      env.CAPACITYLENS_SSO_LABEL ||
      env.CAPACITYLENS_SSO_BOOTSTRAP_EMAILS ||
      env.CAPACITYLENS_GOOGLE_CLIENT_ID ||
      env.CAPACITYLENS_GOOGLE_CLIENT_SECRET ||
      env.CAPACITYLENS_MICROSOFT_CLIENT_ID ||
      env.CAPACITYLENS_MICROSOFT_CLIENT_SECRET ||
      env.CAPACITYLENS_MICROSOFT_TENANT_ID ||
      env.CAPACITYLENS_GITHUB_CLIENT_ID ||
      env.CAPACITYLENS_GITHUB_CLIENT_SECRET
    )
  ) {
    throw new AccountConfigError('The self-hosted-password profile does not permit external identity providers.')
  }
  if (profile === 'self-hosted-mixed' && env.CAPACITYLENS_AUTH !== 'password') {
    throw new AccountConfigError('The self-hosted-mixed profile requires password mode with an additive OIDC provider.')
  }
  if (profile === 'self-hosted-sso-only' && env.CAPACITYLENS_AUTH !== 'sso') {
    throw new AccountConfigError('The self-hosted-sso-only profile requires SMALLSASS_ACCOUNT_MODE=sso.')
  }
  if (profile === 'self-hosted-mixed' || profile === 'self-hosted-sso-only') {
    if (
      !env.CAPACITYLENS_SSO_CLIENT_ID ||
      !env.CAPACITYLENS_SSO_CLIENT_SECRET ||
      !env.CAPACITYLENS_SSO_DISCOVERY_URL ||
      !env.CAPACITYLENS_SSO_ISSUER
    ) {
      throw new AccountConfigError(`${profile} requires a strict OIDC client, issuer, and discovery document.`)
    }
  }
  if (
    profile !== null &&
    (env.CAPACITYLENS_SSO_AUTHORIZATION_URL || env.CAPACITYLENS_SSO_TOKEN_URL)
  ) {
    throw new AccountConfigError('Named account profiles require discovery; explicit OIDC endpoint overrides are not accepted.')
  }

  resolvedAccountEnvironments.set(env, profile)
  return { env, profile }
}

export function resetAccountConfigWarningStateForTests(): void {
  warnedAliases.clear()
}
