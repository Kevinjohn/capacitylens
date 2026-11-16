import app from '@adonisjs/core/services/app';
import { type HttpContext, ExceptionHandler } from '@adonisjs/core/http';
import { mapHttpError } from '#exceptions/http_error_mapping';
import {
  classifyLogError,
  reportPrivateFailure,
  safeRequestMethod,
  safeRoutePattern,
} from '#services/logging_safety';

export default class HttpExceptionHandler extends ExceptionHandler {
  /**
   * In debug mode, the exception handler will display verbose errors
   * with pretty printed stack traces.
   */
  protected debug = app.inDev;

  /**
   * The method is used for handling errors and returning
   * response to the client
   */
  async handle(error: unknown, ctx: HttpContext) {
    const mapped = mapHttpError(error);
    if (mapped) {
      for (const [name, value] of Object.entries(mapped.headers ?? {})) {
        ctx.response.header(name, value);
      }
      return ctx.response.status(mapped.status).send(mapped.body);
    }
    if (this.debug && error instanceof Error) {
      return ctx.response.internalServerError({ error: error.message, stack: error.stack });
    }
    return ctx.response.internalServerError({ error: 'Internal server error.' });
  }

  /**
   * The method is used to report error to the logging service or
   * the a third party error monitoring service.
   *
   * @note You should not attempt to send a response from this method.
   */
  async report(error: unknown, ctx: HttpContext) {
    // Expected refusals are the mapped outcomes below 500; the mapping marks the ones still logged.
    const mapped = mapHttpError(error);
    if (mapped && mapped.status < 500 && !mapped.report) return;
    const failure = mapped?.report ?? { errorType: classifyLogError(error), status: 500 };
    if (!mapped?.report && failure.errorType !== 'unexpected') return;

    reportPrivateFailure(
      ctx,
      {
        event: 'http.request.error',
        errorType: failure.errorType,
        method: safeRequestMethod(ctx.request.method()),
        path: safeRoutePattern(ctx.route?.pattern),
        status: failure.status,
      },
      'HTTP request failed'
    );
  }
}
