import type { HttpContext } from '@adonisjs/core/http';
import capacitylens from '#config/capacitylens';
import { normalizeRequestMethod, normalizeRoutePattern } from '#services/logging_safety';

declare module '@adonisjs/core/http' {
  interface HttpContext {
    /** The validated planning operation, set by the mutation route for the completion line. */
    planningOperation?: string;
  }
}

/** Emit one bounded completion record for every request, including parser and route failures. */
export default class RequestLoggingMiddleware {
  async handle(ctx: HttpContext, next: () => Promise<void>) {
    const method = normalizeRequestMethod(ctx.request.method());
    try {
      await next();
    } finally {
      if (capacitylens.requestLogging) {
        const status = ctx.response.getStatus();
        const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
        const path = normalizeRoutePattern(ctx.route?.pattern);
        try {
          ctx.logger.log(
            level,
            {
              event: 'http.request.completed',
              method,
              path,
              ...(ctx.planningOperation ? { planningOperation: ctx.planningOperation } : {}),
              status,
              outcome: status >= 400 ? 'failure' : 'success',
            },
            'HTTP request completed'
          );
        } catch {
          // Logging is diagnostic only: a failed completion line is reported through the fallback.
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
            );
          } catch {
            // The response must survive when the logger and its safe fallback both fail.
          }
        }
      }
    }
  }
}
