import type { HttpContext } from '@adonisjs/core/http';
import type { NextFn } from '@adonisjs/core/types/http';
import env from '#start/env';

let activeRequests = 0;

/** Count requests through handler completion while the disposable reset fixture is enabled. */
export default class E2eRequestActivityMiddleware {
  async handle({ request, response }: HttpContext, next: NextFn) {
    if (!env.get('CAPACITYLENS_ALLOW_RESET')) return next();

    if (request.method() === 'GET' && request.url().split('?', 1)[0] === '/api/health/e2e-idle') {
      return response.ok({ activeRequests });
    }

    activeRequests += 1;
    try {
      await next();
    } finally {
      activeRequests -= 1;
    }
  }
}
