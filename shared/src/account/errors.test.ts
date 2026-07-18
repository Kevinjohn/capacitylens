import { describe, expect, it } from 'vitest'
import { statusForAccountFailure, type AccountErrorCode } from './errors'

describe('account failure status mapping', () => {
  it.each<[AccountErrorCode, number]>([
    ['AUTHENTICATION_REQUIRED', 401],
    ['FORBIDDEN', 403],
    ['INVITATION_EXPIRED', 410],
    ['INVITATION_USED', 409],
    ['COMMAND_IN_PROGRESS', 409],
    ['RATE_LIMITED', 429],
    ['DEPENDENCY_UNAVAILABLE', 503],
    ['VALIDATION_FAILED', 400],
  ])('%s maps to %s', (code, status) => {
    expect(statusForAccountFailure({ code, message: code, retryable: false })).toBe(status)
  })
})
