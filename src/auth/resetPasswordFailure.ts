import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '@capacitylens/shared/domain/password'
import { m } from '@/i18n'

// Plain .ts module (no component) so ResetPassword.tsx stays a components-only file and this helper
// can be exported without tripping react-refresh/only-export-components — the controls.ts idiom.

/** Map the redeem endpoint's failure body to the surfaced message. Better Auth 400s carry a typed
 *  `{ code }`: INVALID_TOKEN covers unknown/used/expired alike (single-use tokens are CONSUMED on
 *  redeem, so "used" is indistinguishable from "unknown" by design). We map ONLY recognised codes and
 *  otherwise fall back to our generic message — we deliberately do NOT surface a raw server
 *  `body.message`, because an off-mode server (where this route isn't mounted) answers with Fastify's
 *  internal "Route POST:/api/auth/reset-password not found" string, which must never reach the user.
 *  Exported so this library-shape sniff is test-pinned per DEFENSIVE-CODING.md §2 — see
 *  ResetPassword.test.tsx. The caller casts an untyped `res.json()` result `as { code?: string }`
 *  without runtime validation, so `body` itself is untrusted (a same-shape-JSON server could answer
 *  `null`/a string/an array) — `body?.code` keeps that a safe `undefined` (→ generic fallback)
 *  instead of a `TypeError` crashing the submit handler. */
export function messageForFailure(body: { code?: string }): string {
  if (body?.code === 'INVALID_TOKEN') return m.reset_err_invalid()
  if (body?.code === 'PASSWORD_TOO_SHORT') return m.reset_err_short({ min: MIN_PASSWORD_LENGTH })
  if (body?.code === 'PASSWORD_TOO_LONG') return m.reset_err_long({ max: MAX_PASSWORD_LENGTH })
  return m.reset_err_generic()
}
