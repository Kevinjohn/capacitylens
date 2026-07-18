/**
 * Version markers carried by implementations and CI evidence.
 *
 * They are repository-local until the first sibling triggers package promotion. At that review the
 * same values become package metadata; consumers must never infer security currency from the
 * product version alone.
 */
export const ACCOUNT_CONTRACT_VERSION = '1.0.0'
export const ACCOUNT_CONFORMANCE_VERSION = '1.0.0'
export const MINIMUM_ACCOUNT_SECURITY_VERSION = '1.0.0'
export const ACCOUNT_SECURITY_BASELINE_ID = 'ACCOUNT-SEC-2026-07-18-01'

export const ACCOUNT_DEPLOYMENT_PROFILES = [
  'self-hosted-password',
  'self-hosted-mixed',
  'self-hosted-sso-only',
  'hosted-oidc-only',
] as const

export type AccountDeploymentProfile = typeof ACCOUNT_DEPLOYMENT_PROFILES[number]

export function isAccountDeploymentProfile(value: unknown): value is AccountDeploymentProfile {
  return typeof value === 'string' &&
    (ACCOUNT_DEPLOYMENT_PROFILES as readonly string[]).includes(value)
}

export interface AccountProfileCapabilities {
  passwordSignIn: boolean
  strictOidc: boolean
  hosted: boolean
}

export const ACCOUNT_PROFILE_CAPABILITIES: Readonly<Record<
  AccountDeploymentProfile,
  AccountProfileCapabilities
>> = Object.freeze({
  'self-hosted-password': Object.freeze({ passwordSignIn: true, strictOidc: false, hosted: false }),
  'self-hosted-mixed': Object.freeze({ passwordSignIn: true, strictOidc: true, hosted: false }),
  'self-hosted-sso-only': Object.freeze({ passwordSignIn: false, strictOidc: true, hosted: false }),
  'hosted-oidc-only': Object.freeze({ passwordSignIn: false, strictOidc: true, hosted: true }),
})
