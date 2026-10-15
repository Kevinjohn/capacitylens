import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import limiter from '@adonisjs/limiter/services/main'
import { configuredApiLimit, requestClientKey } from '#services/auth/request_limit'

export default class ApiRateLimitMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const path = ctx.request.url()
    const count = configuredApiLimit()
    if (!count || !path.startsWith('/api/') || path.startsWith('/api/health')) return next()
    try {
      await limiter
        .use({ requests: count, duration: '1 minute' })
        .consume(`api:${requestClientKey(ctx)}`)
    } catch (error) {
      if ((error as { status?: number }).status === 429)
        return ctx.response.tooManyRequests({ error: 'Rate limit exceeded.' })
      throw error
    }
    return next()
  }
}
