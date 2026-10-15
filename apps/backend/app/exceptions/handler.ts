import app from '@adonisjs/core/services/app'
import { type HttpContext, ExceptionHandler } from '@adonisjs/core/http'
import { SessionAuthorityError } from '#services/auth/session_authority'
import { IdentityAuthorityError } from '#services/auth/authorization'
import { PasswordProcessingUnavailableError } from '#services/password_service'
import {
  PasswordPolicyError,
  PasswordScreeningUnavailableError,
} from '#services/password_screening'
import {
  classifyLogError,
  reportPrivateFailure,
  safeRequestMethod,
  safeRoutePattern,
} from '#services/logging_safety'

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
    if (
      error instanceof PasswordProcessingUnavailableError ||
      error instanceof PasswordScreeningUnavailableError
    )
      return ctx.response.serviceUnavailable({ error: error.message, code: error.code })
    if (error instanceof PasswordPolicyError)
      return ctx.response.badRequest({ error: error.message, code: error.code })
    if (error instanceof SessionAuthorityError)
      return ctx.response.status(error.status).send({ error: error.message, code: error.code })
    if (error instanceof IdentityAuthorityError)
      return ctx.response.forbidden({ error: error.message, code: error.code })
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
    if (
      error instanceof SessionAuthorityError ||
      error instanceof IdentityAuthorityError ||
      error instanceof PasswordPolicyError
    )
      return
    const dependencyFailure =
      error instanceof PasswordProcessingUnavailableError ||
      error instanceof PasswordScreeningUnavailableError
    const errorType =
      error instanceof PasswordProcessingUnavailableError
        ? 'password_processing_unavailable'
        : error instanceof PasswordScreeningUnavailableError
          ? 'password_screening_unavailable'
          : classifyLogError(error)
    if (!dependencyFailure && errorType !== 'unexpected') return

    reportPrivateFailure(
      ctx,
      {
        event: 'http.request.error',
        errorType,
        method: safeRequestMethod(ctx.request.method()),
        path: safeRoutePattern(ctx.route?.pattern),
        status: dependencyFailure ? 503 : 500,
      },
      'HTTP request failed'
    )
  }
}
