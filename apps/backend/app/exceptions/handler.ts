import app from '@adonisjs/core/services/app';
import { type HttpContext, ExceptionHandler } from '@adonisjs/core/http';
import { errors as vineErrors } from '@vinejs/vine';
import { mapPackageError } from '#exceptions/http_error_mapping';
import ProductException from '#exceptions/product_exception';
import UnexpectedException from '#exceptions/unexpected_exception';
import { normalizeRequestMethod, normalizeRoutePattern } from '#services/logging_safety';

export default class HttpExceptionHandler extends ExceptionHandler {
  // In development a 500 carries the error's message and stack.
  protected debug = app.inDev;

  /** Every answer below 500 is an expected refusal and is not logged. */
  protected ignoreStatuses = Array.from({ length: 100 }, (_, offset) => 400 + offset);

  /**
   * A product exception answers for itself and a Vine failure takes the framework's answer. A
   * package error is answered here in the product's flat body; anything else is an unexpected 500.
   */
  async handle(error: unknown, ctx: HttpContext) {
    if (error instanceof ProductException || error instanceof vineErrors.E_VALIDATION_ERROR) {
      return super.handle(error, ctx);
    }
    const answer = mapPackageError(error);
    if (answer) {
      for (const [name, value] of Object.entries(answer.headers ?? {})) {
        ctx.response.header(name, value);
      }
      return ctx.response.status(answer.status).send(answer.body);
    }
    if (this.debug && error instanceof Error) {
      return ctx.response.internalServerError({ error: error.message, stack: error.stack });
    }
    return super.handle(new UnexpectedException(error), ctx);
  }

  /**
   * Reports what the log may see of an error. A product exception's message is a fixed sentence, so
   * it is reported as it is; anything else reaches the log as an `UnexpectedException` that keeps
   * only its class, frames and causes. A package refusal is reported as the product refusal it is
   * answered with, which the ignored statuses keep out of the log.
   */
  async report(error: unknown, ctx: HttpContext) {
    try {
      await super.report(this.#reportable(error), ctx);
    } catch {
      // The server answers only after the report, so a failed logger must not stop the answer.
      console.error('Private diagnostic logger failed');
    }
  }

  /** Every report names the event, the request method and the route pattern, never the path. */
  protected context(ctx: HttpContext) {
    return {
      ...super.context(ctx),
      event: 'http.request.error',
      method: normalizeRequestMethod(ctx.request.method()),
      path: normalizeRoutePattern(ctx.route?.pattern),
    };
  }

  #reportable(error: unknown) {
    if (error instanceof ProductException || error instanceof vineErrors.E_VALIDATION_ERROR) {
      return error;
    }
    const answer = mapPackageError(error);
    if (answer && answer.status < 500 && !answer.errorType) {
      return new ProductException('Request refused.', { status: answer.status });
    }
    return new UnexpectedException(error, {
      status: answer && answer.status >= 500 ? answer.status : undefined,
      errorType: answer?.errorType,
    });
  }
}
