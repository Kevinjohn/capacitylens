// The ONE true rate-limit env parser, extracted so the production guard and the limiter cannot
// diverge on what CAPACITYLENS_RATE_LIMIT means. It lives in its own leaf module (no imports) so
// productionGuard.ts can share it WITHOUT pulling in the whole Fastify app (app.ts) — an import
// cycle the guard must stay clear of, since index.ts consults the guard before building the app.

export const MAX_RATE_LIMIT = 1_000_000

/** Fail-closed parse of CAPACITYLENS_RATE_LIMIT: only a positive integer turns the limiter on;
 *  unset, '0', negative, or any non-numeric junk ⇒ 0 = off (a typo must not guess a limit).
 *  Deliberately STRICTER than Number(): the digits-only regex rejects ' 100 ' (whitespace),
 *  '1e3' (exponent) and '12.5' (decimal) that Number() would silently coerce, and the
 *  MAX_RATE_LIMIT cap rejects an absurd '2000000' — each of those maps to 0 (off), never to a
 *  surprising limit. This is the same value the production guard checks, so "off" cannot mean one
 *  thing to the guard and another to the limiter. */
export function parseRateLimit(raw: string | undefined): number {
  if (!raw || !/^\d+$/.test(raw)) return 0
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= MAX_RATE_LIMIT ? parsed : 0
}
