import type { HttpContext } from '@adonisjs/core/http';

/** Account identity ids accepted in admission and ownership requests. */
export const USER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** Keeps bearer links out of shared caches and referrers. */
export function setProofHeaders(ctx: HttpContext) {
  ctx.response.header('Cache-Control', 'no-store');
  ctx.response.header('Referrer-Policy', 'no-referrer');
}
