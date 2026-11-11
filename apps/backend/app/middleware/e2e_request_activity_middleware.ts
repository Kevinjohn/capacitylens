import type { HttpContext } from '@adonisjs/core/http';
import type { NextFn } from '@adonisjs/core/types/http';
import env from '#start/env';

const pendingRequests = new Map<symbol, { method: string; path: string; startedAt: number }>();

/** Count requests through handler completion while the disposable reset fixture is enabled. */
export default class E2eRequestActivityMiddleware {
  async handle({ request, response }: HttpContext, next: NextFn) {
    if (!env.get('CAPACITYLENS_ALLOW_RESET')) return next();

    if (request.method() === 'GET' && request.url().split('?', 1)[0] === '/api/health/e2e-idle') {
      return response.ok({
        activeRequests: pendingRequests.size,
        pendingRequests: Array.from(pendingRequests.values(), ({ method, path, startedAt }) => ({
          method,
          path,
          elapsedMs: Math.max(0, Date.now() - startedAt),
        })),
      });
    }

    const requestKey = Symbol();
    pendingRequests.set(requestKey, {
      method: request.method(),
      path: request.url().split('?', 1)[0] ?? '',
      startedAt: Date.now(),
    });
    try {
      await next();
    } finally {
      pendingRequests.delete(requestKey);
    }
  }
}
