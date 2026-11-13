import type { HttpContext } from '@adonisjs/core/http';
import type { NextFn } from '@adonisjs/core/types/http';
export default class SecurityHeadersMiddleware {
  async handle({ request, response }: HttpContext, next: NextFn) {
    response.header('Cross-Origin-Opener-Policy', 'same-origin');
    response.header('Cross-Origin-Resource-Policy', 'same-origin');
    response.header('Referrer-Policy', 'no-referrer');
    response.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.header('Access-Control-Expose-Headers', 'x-capacitylens-audit-warning');
    response.header('Cache-Control', 'no-store');
    response.header('Pragma', 'no-cache');
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
