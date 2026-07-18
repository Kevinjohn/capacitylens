import { MAX_EMAIL_LENGTH, MAX_NAME_LENGTH } from '../lib/strings'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '../domain/password'
import type { BoundApplication } from './types'

export function boundApplicationFailure(application: unknown): string | null {
  if (typeof application !== 'object' || application === null) {
    return 'The account application binding must be an object.'
  }
  const candidate = application as Partial<BoundApplication>
  if (
    typeof candidate.applicationId !== 'string' ||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(candidate.applicationId)
  ) {
    return 'The account application id must match ^[a-z0-9][a-z0-9_-]{0,63}$.'
  }
  if (typeof candidate.displayName !== 'string' || !candidate.displayName.trim()) {
    return 'The account application display name must not be empty.'
  }
  const branding = candidate.branding
  if (
    typeof branding !== 'object' ||
    branding === null ||
    typeof branding.totpIssuer !== 'string' ||
    !branding.totpIssuer.trim() ||
    typeof branding.defaultProviderLabel !== 'string' ||
    !branding.defaultProviderLabel.trim() ||
    !Array.isArray(branding.passwordContextWords) ||
    branding.passwordContextWords.length === 0 ||
    branding.passwordContextWords.some((word) => typeof word !== 'string' || !word.trim())
  ) {
    return 'Account branding must define a TOTP issuer, provider label, and non-empty password context words.'
  }
  return null
}

export function normalizeAccountEmail(value: string): string {
  return value.trim().toLowerCase()
}

export function isAccountEmail(value: string): boolean {
  if (value.length === 0 || value.length > MAX_EMAIL_LENGTH || value !== value.trim()) return false
  return /^[^@\s]+@[^@\s]+$/.test(value)
}

export type CredentialInputFailure = 'email' | 'display-name' | 'password-length'

/** Transport-independent credential validation used by every identity adapter. */
export function validateCredentialInput(input: {
  email: string
  displayName: string
  password: string
}): CredentialInputFailure | null {
  if (!isAccountEmail(input.email) || normalizeAccountEmail(input.email) !== input.email) return 'email'
  if (
    input.displayName !== input.displayName.trim() ||
    input.displayName.length === 0 ||
    input.displayName.length > MAX_NAME_LENGTH
  ) return 'display-name'
  if (input.password.length < MIN_PASSWORD_LENGTH || input.password.length > MAX_PASSWORD_LENGTH) {
    return 'password-length'
  }
  return null
}
