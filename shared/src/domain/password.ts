// Password policy — the pure, environment-agnostic numbers BOTH halves of the app must agree on.
// A dependency-free leaf (no runtime deps, no I/O), so the server (Better Auth config) and the client
// (the reset-page pre-check) import the SAME source and can't drift — the repo's standard no-drift
// pattern (see access.ts). If these diverged, the client would accept a password the server rejects
// and then show a length message that contradicts the real bound.

/**
 * The minimum password length, in Unicode code points. CapacityLens enforces it before Better
 * Auth's UTF-16-based guard and passes the same numeric floor explicitly so a library upgrade cannot
 * weaken its coarse transport check. The reset-password page consumes the same policy and its
 * "at least N characters" message (src/auth/ResetPassword.tsx), so the two never disagree.
 *
 * OWASP ASVS 5.0.0 V6.2.1 requires at least 8 and strongly recommends 15 when passwords are used;
 * CapacityLens uses the stronger recommendation because password mode is internet-deployable.
 */
export const MIN_PASSWORD_LENGTH = 15

/**
 * The maximum password length, in Unicode code points. Same no-drift contract as
 * {@link MIN_PASSWORD_LENGTH}: consumed by the server credential boundaries and the
 * reset-password page's pre-check + PASSWORD_TOO_LONG message (src/auth/ResetPassword.tsx), so an
 * over-long passphrase gets an actionable bound instead of a generic failure — and the bound the
 * client states is always the one the server enforces.
 *
 * 128 preserves the product's established ceiling independently of Better Auth's UTF-16-based
 * transport guard.
 */
export const MAX_PASSWORD_LENGTH = 128

/**
 * Better Auth and HTML `maxlength` count UTF-16 code units. A valid password may use two code units
 * for every code point, so their transport/input ceiling must allow this many code units before
 * CapacityLens applies its own code-point policy.
 */
export const MAX_PASSWORD_INPUT_CODE_UNITS = MAX_PASSWORD_LENGTH * 2

export type PasswordLengthFailure = 'too-short' | 'too-long'

/** Count the length unit CapacityLens calls a password "character": a Unicode code point. */
export function passwordCharacterCount(password: string): number {
  return Array.from(password).length
}

/** Return the precise password-length policy failure, if any. */
export function passwordLengthFailure(password: string): PasswordLengthFailure | null {
  const length = passwordCharacterCount(password)
  if (length < MIN_PASSWORD_LENGTH) return 'too-short'
  if (length > MAX_PASSWORD_LENGTH) return 'too-long'
  return null
}
