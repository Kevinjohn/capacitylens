import app from '@adonisjs/core/services/app'
import { type HttpContext, ExceptionHandler } from '@adonisjs/core/http'
import { classifyLogError, safeRequestMethod, safeRoutePattern } from '#services/logging_safety'

export default class HttpExceptionHandler extends ExceptionHandler {
  /**
   * In debug mode, the exception handler will display verbose errors
   * with pretty printed stack traces.
   */
  protected debug = !app.inProduction

  /**
   * The method is used for handling errors and returning
   * response to the client
   */
  async handle(error: unknown, ctx: HttpContext) {
    if (typeof error === 'object' && error !== null) {
      const code = 'code' in error ? error.code : undefined
      if (code === 'E_VALIDATION_ERROR') {
        const messages =
          'messages' in error && Array.isArray(error.messages) ? error.messages : undefined
        const first = messages?.[0]
        const message =
          typeof first === 'object' && first !== null && 'message' in first
            ? String(first.message)
            : 'Invalid request.'
        return ctx.response.badRequest({ error: message })
      }
      if (code === 'E_ROUTE_NOT_FOUND') return ctx.response.notFound({ error: 'Not found.' })
      if (code === 'E_REQUEST_ENTITY_TOO_LARGE')
        return ctx.response.status(413).send({ error: 'Request body is too large.' })
      if (code === 'E_ENCODING_UNSUPPORTED')
        return ctx.response.status(415).send({ error: 'Unsupported media type.' })
      if (
        code === 'SQLITE_CONSTRAINT_NOTNULL' ||
        code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
        code === 'SQLITE_CONSTRAINT_UNIQUE' ||
        code === 'SQLITE_CONSTRAINT_FOREIGNKEY' ||
        code === 'SQLITE_CONSTRAINT_CHECK'
      )
        return ctx.response.badRequest({
          error: 'That change references missing data or conflicts with an existing record.',
        })
    }
    return ctx.response.internalServerError({ error: 'Internal server error.' })
  }

  /**
   * The method is used to report error to the logging service or
   * the a third party error monitoring service.
   *
   * @note You should not attempt to send a response from this method.
   */
  async report(error: unknown, ctx: HttpContext) {
    const errorType = classifyLogError(error)
    if (errorType !== 'unexpected') return

    ctx.logger.error(
      {
        event: 'http.request.error',
        errorType,
        err: error,
        method: safeRequestMethod(ctx.request.method()),
        path: safeRoutePattern(ctx.route?.pattern),
        status: 500,
      },
      'HTTP request failed'
    )
  }
}
