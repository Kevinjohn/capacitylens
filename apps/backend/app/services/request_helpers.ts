import type { HttpContext } from '@adonisjs/core/http';

/** Keeps bearer links out of shared caches and referrers. */
export function setProofHeaders(response: HttpContext['response']) {
  response.header('Cache-Control', 'no-store');
  response.header('Referrer-Policy', 'no-referrer');
}
