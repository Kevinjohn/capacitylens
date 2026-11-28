import app from '@adonisjs/core/services/app'
import { type HttpContext, ExceptionHandler } from '@adonisjs/core/http'
import { errors as vineErrors } from '@vinejs/vine'
import { errors as masqueradeErrors } from '@kevinjohn/adonisjs-masquerade'
import { mapPackageError } from '#services/errors/http_error_mapping'
import ProductException from '#exceptions/product_exception'
import UnexpectedException from '#exceptions/unexpected_exception'
import AccountKitFailureException from '#exceptions/account_kit_failure_exception'
import MasqueradeUnavailableException from '#exceptions/masquerade_unavailable_exception'
import { normalizeRequestMethod, normalizeRoutePattern } from '#services/logging_safety'

export default class HttpExceptionHandler extends ExceptionHandler {
  // Outside production a 500 carries the error's message and stack.
  protected debug = !app.inProduction

  /** Every answer below 500 is an expected refusal and is not logged. */
  protected ignoreStatuses = Array.from({ length: 100 }, (_, offset) => 400 + offset)

  /**
   * A product exception answers for itself and a Vine failure takes the framework's answer. A
   * package error is answered here in the product's flat body; anything else is an unexpected 500.
   */
  async handle(error: unknown, ctx: HttpContext) {
    if (error instanceof ProductException || error instanceof vineErrors.E_VALIDATION_ERROR) {
      return super.handle(error, ctx)
    }
    const answer = mapPackageError(error)
    if (answer) {
      for (const [name, value] of Object.entries(answer.headers ?? {})) {
        ctx.response.header(name, value)
      }
      return ctx.response.status(answer.status).send(answer.body)
    }
    if (this.debug && error instanceof Error) {
      return ctx.response.internalServerError({ error: error.message, stack: error.stack })
    }
    return super.handle(new UnexpectedException(error), ctx)
  }

  /**
   * Reports what the log may see of an error. A product exception's message is a fixed sentence, so
   * it is reported as it is; anything else reaches the log as an `UnexpectedException` that keeps
   * only its class, frames and causes. A package server fault is reported as the fault it is
   * answered with, and a package refusal below 500 is an expected outcome that is not logged.
   */
  async report(error: unknown, ctx: HttpContext) {
    try {
      const reportable = this.#reportable(error)
      if (reportable) await super.report(reportable, ctx)
    } catch {
      // The server answers only after the report, so a failed report must not stop the answer. The
      // fallback line carries fixed fields only, and a logger that fails again is left alone.
      try {
        ctx.logger.error(
          { event: 'http.request.report_failed', errorType: 'logging_failure' },
          'Private diagnostic logger failed'
        )
      } catch {
        // The answer must survive when the logger and its safe fallback both fail.
      }
    }
  }

  /** Every report names the event, the request method and the route pattern, never the path. */
  protected context(ctx: HttpContext) {
    return {
      ...super.context(ctx),
      event: 'http.request.error',
      method: normalizeRequestMethod(ctx.request.method()),
      path: normalizeRoutePattern(ctx.route?.pattern),
    }
  }

  #reportable(error: unknown) {
    if (error instanceof ProductException || error instanceof vineErrors.E_VALIDATION_ERROR) {
      return error
    }
    const answer = mapPackageError(error)
    if (answer && answer.status < 500) return undefined
    if (answer?.errorType) return new AccountKitFailureException(error)
    if (error instanceof masqueradeErrors.E_MASQUERADE_UNAVAILABLE) {
      return new MasqueradeUnavailableException(error)
    }
    return new UnexpectedException(error)
  }
}
