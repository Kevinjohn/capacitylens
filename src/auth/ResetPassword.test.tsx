import { describe, it, expect } from 'vitest'
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '@capacitylens/shared/domain/password'
import { m } from '@/i18n'
import { messageForFailure } from './resetPasswordFailure'

// Pins the library-shape sniff in messageForFailure (DEFENSIVE-CODING.md §2: a sniff of a library's
// message/body shape must be test-pinned). Better Auth's redeem endpoint answers a 400 with a typed
// `{ code }`; this test locks the mapping from each recognised code — and every unrecognised shape —
// to the exact user-facing message, so a future Better Auth upgrade that renames/drops a code fails
// this test instead of silently regressing to the generic fallback (or worse, staying silent).
describe('ResetPassword — messageForFailure (Better Auth 400 body → surfaced message)', () => {
  it('maps INVALID_TOKEN to the invalid-link message', () => {
    expect(messageForFailure({ code: 'INVALID_TOKEN' })).toBe(m.reset_err_invalid())
  })

  it('maps PASSWORD_TOO_SHORT to the short message with MIN_PASSWORD_LENGTH interpolated', () => {
    expect(messageForFailure({ code: 'PASSWORD_TOO_SHORT' })).toBe(
      m.reset_err_short({ min: MIN_PASSWORD_LENGTH }),
    )
  })

  it('maps PASSWORD_TOO_LONG to the long message with MAX_PASSWORD_LENGTH interpolated', () => {
    expect(messageForFailure({ code: 'PASSWORD_TOO_LONG' })).toBe(
      m.reset_err_long({ max: MAX_PASSWORD_LENGTH }),
    )
  })

  it('falls back to the generic message for an unrecognised code', () => {
    expect(messageForFailure({ code: 'SOME_FUTURE_CODE' })).toBe(m.reset_err_generic())
  })

  it('falls back to the generic message when code is missing', () => {
    expect(messageForFailure({})).toBe(m.reset_err_generic())
  })

  it('falls back to the generic message for a non-object body (e.g. a bare JSON `null`)', () => {
    // The call site casts an untyped fetch body `as { code?: string }` without validating shape —
    // a server that answers valid-but-unexpected JSON (null, a string, an array) must not throw here.
    expect(messageForFailure(null as unknown as { code?: string })).toBe(m.reset_err_generic())
  })
})
