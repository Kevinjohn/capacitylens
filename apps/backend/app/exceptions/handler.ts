import app from '@adonisjs/core/services/app'
import { type HttpContext, ExceptionHandler } from '@adonisjs/core/http'
import { errors as vineErrors } from '@vinejs/vine'
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
    if (error instanceof vineErrors.E_VALIDATION_ERROR) {
      const first = error.messages[0]
      return ctx.response.badRequest({
        error: first?.message ?? 'Invalid request.',
        code: 'VALIDATION_ERROR',
      })
    }
    if (
      error instanceof Error &&
      'status' in error &&
      error.status === 415 &&
      error.message.startsWith('Unsupported Content-Encoding:')
    )
      return ctx.response.status(415).send({
        error: 'Unsupported media type.',
        code: 'UNSUPPORTED_MEDIA_TYPE',
      })
    if (
      error instanceof SyntaxError &&
      'status' in error &&
      error.status === 400 &&
      'body' in error &&
      typeof error.body === 'string'
    )
      return ctx.response.badRequest({
        error: 'Request body must be valid JSON.',
        code: 'INVALID_JSON',
      })
    if (
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      error.status === 422 &&
      'message' in error &&
      error.message === 'Invalid JSON, only supports object and array'
    )
      return ctx.response.badRequest({
        error: 'Request JSON must be an object or array.',
        code: 'INVALID_JSON_SHAPE',
      })
    if (typeof error === 'object' && error !== null) {
      const code = 'code' in error ? error.code : undefined
      if (code === 'E_ROUTE_NOT_FOUND')
        return ctx.response.notFound({ error: 'Not found.', code: 'NOT_FOUND' })
      if (code === 'E_REQUEST_ENTITY_TOO_LARGE')
        return ctx.response
          .status(413)
          .send({ error: 'Request body is too large.', code: 'PAYLOAD_TOO_LARGE' })
      if (code === 'E_ENCODING_UNSUPPORTED')
        return ctx.response
          .status(415)
          .send({ error: 'Unsupported media type.', code: 'UNSUPPORTED_MEDIA_TYPE' })
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
    if (
      error instanceof vineErrors.E_VALIDATION_ERROR ||
      (error instanceof SyntaxError &&
        'status' in error &&
        error.status === 400 &&
        'body' in error &&
        typeof error.body === 'string') ||
      (typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        error.status === 422 &&
        'message' in error &&
        error.message === 'Invalid JSON, only supports object and array') ||
      (error instanceof Error &&
        'status' in error &&
        error.status === 415 &&
        error.message.startsWith('Unsupported Content-Encoding:')) ||
      (typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        ['E_REQUEST_ENTITY_TOO_LARGE', 'E_ENCODING_UNSUPPORTED'].includes(String(error.code)))
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
