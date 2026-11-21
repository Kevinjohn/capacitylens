import type { HttpContext } from '@adonisjs/core/http';
import type { NextFn } from '@adonisjs/core/types/http';
import { publicOrigin } from '#config/public_origin';
import { contentSecurityPolicy } from '#config/shield';
export default class SecurityHeadersMiddleware {
  async handle({ request, response }: HttpContext, next: NextFn) {
    response.header('Cross-Origin-Opener-Policy', 'same-origin');
    response.header('Cross-Origin-Resource-Policy', 'same-origin');
    response.header('Referrer-Policy', 'no-referrer');
    response.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.header('Access-Control-Expose-Headers', 'x-capacitylens-audit-warning');
    response.header('Cache-Control', 'no-store');
    response.header('Pragma', 'no-cache');
    // Shield runs only after a route matches, so static files and server-stack refusals get its headers here.
    response.header('X-Content-Type-Options', 'nosniff');
    response.header('X-Frame-Options', 'DENY');
    response.header('Content-Security-Policy', contentSecurityPolicy);
    if (publicOrigin.secure) response.header('Strict-Transport-Security', 'max-age=31536000');
    await next();
    const body = response.getBody();
    if (
      request.url().startsWith('/api/') &&
      typeof body === 'object' &&
      body !== null &&
      !Buffer.isBuffer(body)
    ) {
      response.type('application/json');
    }
  }
}
