import type { HttpContext } from '@adonisjs/core/http';

/** Reports whether a request body is a plain object that carries no key outside `allowed`. */
export function hasOnlyFields(
  value: unknown,
  allowed: readonly string[]
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => allowed.includes(key))
  );
}

/** Keeps bearer links out of shared caches and referrers. */
export function proofHeaders(ctx: HttpContext) {
  ctx.response.header('Cache-Control', 'no-store');
  ctx.response.header('Referrer-Policy', 'no-referrer');
}
