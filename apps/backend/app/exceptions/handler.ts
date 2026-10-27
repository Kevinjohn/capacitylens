import type {
  HttpErrorBody,
  ProductHttpErrorBody,
  ProductValidationFailure,
} from '@capacitylens/shared/api/httpErrors'
import app from '@adonisjs/core/services/app'
import { type HttpContext, ExceptionHandler } from '@adonisjs/core/http'
import { errors as vineErrors } from '@vinejs/vine'
import { accountErrorResponse } from 'adonisjs-account-kit'
import { AdmissionRequiredError } from 'adonisjs-account-kit/admission'
import { IdentityAuthorityError } from '#services/auth/authorization'
import { ActionProofError } from '#services/auth/action_proof'
import { AdmissionError } from '#services/admission/errors'
import { FirstCompanyPendingError } from '#models/user'
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
  protected debug = app.inDev

  /**
   * The method is used for handling errors and returning
   * response to the client
   */
  async handle(error: unknown, ctx: HttpContext) {
    // The limited screens explain the decision, so it travels with the refusal.
    if (error instanceof AdmissionRequiredError)
      return ctx.response.forbidden({
        error: 'Your access to this company is waiting on admission.',
        code: 'ADMISSION_REQUIRED',
        decision: error.decision,
      } satisfies ProductHttpErrorBody)
    const kitResponse = accountErrorResponse(error)
    if (kitResponse) {
      for (const [name, value] of Object.entries(kitResponse.headers))
        ctx.response.header(name, value)
      const { code, message, committed } = kitResponse.body
      return ctx.response
        .status(kitResponse.status)
        .send({ error: message, code, ...(committed ? { committed } : {}) } satisfies HttpErrorBody)
    }
    if (error instanceof AdmissionError)
      return ctx.response.status(error.status).send({
        error: error.message,
        code: error.code,
        ...(error.decision === undefined ? {} : { decision: error.decision }),
      })
    if (error instanceof ActionProofError || error instanceof FirstCompanyPendingError)
      return ctx.response.status(error.status).send({ error: error.message, code: error.code })
    if (error instanceof IdentityAuthorityError)
      return ctx.response.forbidden({ error: error.message, code: error.code })
    if (error instanceof vineErrors.E_VALIDATION_ERROR) {
      const first = error.messages[0]
      return ctx.response.badRequest({
        error: first?.message ?? 'Invalid request.',
        code: 'VALIDATION_ERROR',
      } satisfies ProductValidationFailure['body'])
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
      } satisfies ProductHttpErrorBody)
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
      } satisfies ProductHttpErrorBody)
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
      } satisfies ProductHttpErrorBody)
    if (typeof error === 'object' && error !== null) {
      const code = 'code' in error ? error.code : undefined
      if (code === 'E_ROUTE_NOT_FOUND')
        return ctx.response.notFound({
          error: 'Not found.',
          code: 'NOT_FOUND',
        } satisfies ProductHttpErrorBody)
      if (code === 'E_REQUEST_ENTITY_TOO_LARGE')
        return ctx.response.status(413).send({
          error: 'Request body is too large.',
          code: 'PAYLOAD_TOO_LARGE',
        } satisfies ProductHttpErrorBody)
      if (code === 'E_ENCODING_UNSUPPORTED')
        return ctx.response.status(415).send({
          error: 'Unsupported media type.',
          code: 'UNSUPPORTED_MEDIA_TYPE',
        } satisfies ProductHttpErrorBody)
      if (
        code === 'SQLITE_CONSTRAINT_NOTNULL' ||
        code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
        code === 'SQLITE_CONSTRAINT_UNIQUE' ||
        code === 'SQLITE_CONSTRAINT_FOREIGNKEY' ||
        code === 'SQLITE_CONSTRAINT_CHECK'
      )
        return ctx.response.badRequest({
          error: 'That change references missing data or conflicts with an existing record.',
          code: 'VALIDATION_ERROR',
        } satisfies ProductValidationFailure['body'])
    }
    if (this.debug && error instanceof Error)
      return ctx.response.internalServerError({ error: error.message, stack: error.stack })
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
      error instanceof IdentityAuthorityError ||
      error instanceof AdmissionError ||
      error instanceof ActionProofError ||
      error instanceof FirstCompanyPendingError
    )
      return
    // Account Kit refusals are expected outcomes; its server faults are still reported.
    const kitResponse = accountErrorResponse(error)
    if (kitResponse && kitResponse.status < 500) return
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
    const dependencyFailure = Boolean(kitResponse)
    const errorType = kitResponse ? 'account_kit_failure' : classifyLogError(error)
    if (!dependencyFailure && errorType !== 'unexpected') return

    reportPrivateFailure(
      ctx,
      {
        event: 'http.request.error',
        errorType,
        method: safeRequestMethod(ctx.request.method()),
        path: safeRoutePattern(ctx.route?.pattern),
        status: kitResponse?.status ?? 500,
      },
      'HTTP request failed'
    )
  }
}
