import type { CommandId } from './types'

export type AccountErrorCode =
  | 'AUTHENTICATION_REQUIRED'
  | 'MFA_REQUIRED'
  | 'SESSION_NOT_FRESH'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'NOT_MEMBER'
  | 'VALIDATION_FAILED'
  | 'CONFLICT'
  | 'COMMAND_IN_PROGRESS'
  | 'OWNER_TRANSFER_REQUIRED'
  | 'INVITATION_EXPIRED'
  | 'INVITATION_USED'
  | 'INVITATION_EMAIL_MISMATCH'
  | 'IDENTITY_ALREADY_EXISTS'
  | 'AUTHORITY_CHANGED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'COMPENSATION_FAILED'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'DEPENDENCY_INVALID_RESPONSE'
  | 'RATE_LIMITED'
  | 'UNSUPPORTED_CAPABILITY'

export interface AccountFailure {
  code: AccountErrorCode
  message: string
  retryable: boolean
  commandId?: CommandId
  retryAfterSeconds?: number
}

/** Normalized boundary error. Vendor/SQL errors remain internal causes, never public shapes. */
export class AccountContractError extends Error {
  readonly failure: AccountFailure

  constructor(failure: AccountFailure, options: ErrorOptions = {}) {
    super(failure.message, options)
    this.name = 'AccountContractError'
    this.failure = failure
  }
}

export function statusForAccountFailure(failure: AccountFailure): number {
  switch (failure.code) {
    case 'AUTHENTICATION_REQUIRED':
      return 401
    case 'MFA_REQUIRED':
    case 'SESSION_NOT_FRESH':
    case 'FORBIDDEN':
    case 'NOT_MEMBER':
    case 'INVITATION_EMAIL_MISMATCH':
      return 403
    case 'NOT_FOUND':
      return 404
    case 'INVITATION_EXPIRED':
      return 410
    case 'INVITATION_USED':
    case 'CONFLICT':
    case 'COMMAND_IN_PROGRESS':
    case 'AUTHORITY_CHANGED':
    case 'IDEMPOTENCY_CONFLICT':
      return 409
    case 'RATE_LIMITED':
      return 429
    case 'DEPENDENCY_UNAVAILABLE':
    case 'DEPENDENCY_INVALID_RESPONSE':
    case 'COMPENSATION_FAILED':
      return 503
    case 'VALIDATION_FAILED':
    case 'OWNER_TRANSFER_REQUIRED':
    case 'IDENTITY_ALREADY_EXISTS':
    case 'UNSUPPORTED_CAPABILITY':
      return 400
  }
  // Runtime input may have escaped static validation. An unknown account error is never a success
  // or an authorization denial; surface it as an internal failure.
  return 500
}
