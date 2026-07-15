// Password policy — the pure, environment-agnostic numbers BOTH halves of the app must agree on.
// A types-only leaf (no runtime deps, no I/O), so the server (Better Auth config) and the client
// (the reset-page pre-check) import the SAME source and can't drift — the repo's standard no-drift
// pattern (see access.ts). If these diverged, the client would accept a password the server rejects
// and then show a length message that contradicts the real bound.

/**
 * The minimum password length, in characters. Passed EXPLICITLY to Better Auth's
 * `emailAndPassword.minPasswordLength` (server/src/auth.ts) so the server bound is pinned to THIS
 * value rather than inheriting a library default that a future upgrade could change, and consumed by
 * the reset-password page's client-side pre-check + its "at least N characters" message
 * (src/auth/ResetPassword.tsx) so the two never disagree.
 *
 * OWASP ASVS 5.0.0 V6.2.1 requires at least 8 and strongly recommends 15 when passwords are used;
 * CapacityLens uses the stronger recommendation because password mode is internet-deployable.
 */
export const MIN_PASSWORD_LENGTH = 15

/**
 * The maximum password length, in characters. Same no-drift contract as {@link MIN_PASSWORD_LENGTH}:
 * passed EXPLICITLY to Better Auth's `emailAndPassword.maxPasswordLength` (server/src/auth.ts) and
 * consumed by the reset-password page's pre-check + PASSWORD_TOO_LONG message
 * (src/auth/ResetPassword.tsx), so an over-long passphrase gets an actionable bound instead of a
 * generic failure — and the bound the client states is always the one the server enforces.
 *
 * 128 matches Better Auth 1.6.20's own default; pinned so a library upgrade can't silently move it.
 */
export const MAX_PASSWORD_LENGTH = 128
