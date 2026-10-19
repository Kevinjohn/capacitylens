import type { HttpContext } from '@adonisjs/core/http'
import env from '#start/env'
import { safeRequestMethod, safeRoutePattern } from '#services/logging_safety'

let requestSequence = 0

function nextCorrelationId(): string {
  requestSequence += 1
  return `${Date.now().toString(36)}-${requestSequence.toString(36)}`
}

/** Emit one bounded completion record for every request, including parser and route failures. */
export default class RequestLoggingMiddleware {
  async handle(ctx: HttpContext, next: () => Promise<void>) {
    ctx.logger = ctx.logger.child({ correlationId: nextCorrelationId() })

    const method = safeRequestMethod(ctx.request.method())
    try {
      await next()
    } finally {
      if (env.get('CAPACITYLENS_LOG') === '1') {
        const status = ctx.response.getStatus()
        const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info'
        const path = safeRoutePattern(ctx.route?.pattern)
        try {
          ctx.logger.log(
            level,
            {
              event: 'http.request.completed',
              method,
              path,
              status,
              outcome: status >= 400 ? 'failure' : 'success',
            },
            'HTTP request completed'
          )
        } catch {
          try {
            ctx.logger.error(
              {
                event: 'http.request.logging_failed',
                errorType: 'logging_failure',
                method,
                path,
                status,
              },
              'HTTP request completion logging failed'
            )
          } catch {
            // The response must survive when the logger and its safe fallback both fail.
          }
        }
      }
    }
  }
}
