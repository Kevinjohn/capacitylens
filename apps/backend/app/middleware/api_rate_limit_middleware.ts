import type { HttpContext } from '@adonisjs/core/http';
import type { NextFn } from '@adonisjs/core/types/http';
import limiter from '@adonisjs/limiter/services/main';
import { readApiLimit, requestClientKey } from '#services/auth/request_limit';

export default class ApiRateLimitMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const path = ctx.request.url();
    const count = readApiLimit();
    if (!count || !path.startsWith('/api/') || path.startsWith('/api/health')) return next();
    // An exhausted limit throws E_TOO_MANY_REQUESTS, which the exception handler answers with 429.
    await limiter
      .use({ requests: count, duration: '1 minute' })
      .consume(`api:${requestClientKey(ctx.request.ip())}`);
    return next();
  }
}
