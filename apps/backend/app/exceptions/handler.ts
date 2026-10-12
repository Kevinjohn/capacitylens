import app from '@adonisjs/core/services/app'
import { type HttpContext, ExceptionHandler } from '@adonisjs/core/http'

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
      if (typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT'))
        return ctx.response.badRequest({
          error: 'That change references missing data or conflicts with an existing record.',
        })
    }
    return super.handle(error, ctx)
  }

  /**
   * The method is used to report error to the logging service or
   * the a third party error monitoring service.
   *
   * @note You should not attempt to send a response from this method.
   */
  async report(error: unknown, ctx: HttpContext) {
    return super.report(error, ctx)
  }
}
