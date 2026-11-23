import app from '@adonisjs/core/services/app';
import { type HttpContext, ExceptionHandler } from '@adonisjs/core/http';
import { mapHttpError } from '#exceptions/http_error_mapping';
import { classifyLogError } from '#config/logger';
import {
  describeFailure,
  reportPrivateFailure,
  normalizeRequestMethod,
  normalizeRoutePattern,
} from '#services/logging_safety';

export default class HttpExceptionHandler extends ExceptionHandler {
  // In development a 500 carries the error's message and stack.
  protected debug = app.inDev;

  /** Answers a mapped refusal with its body, anything else with a bare 500. */
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
   * Logs server faults with their class and stack frames, never the message; expected refusals are
   * not logged.
   */
  async report(error: unknown, ctx: HttpContext) {
    // Expected refusals are the mapped outcomes below 500; the mapping marks the ones still logged.
    const mapped = mapHttpError(error);
    if (mapped && mapped.status < 500 && !mapped.report) return;
    const failure = mapped?.report ?? { errorType: classifyLogError(error), status: 500 };
    if (!mapped?.report && failure.errorType !== 'unexpected') return;

    reportPrivateFailure(
      ctx.logger,
      {
        event: 'http.request.error',
        errorType: failure.errorType,
        method: normalizeRequestMethod(ctx.request.method()),
        path: normalizeRoutePattern(ctx.route?.pattern),
        status: failure.status,
        ...(failure.errorType === 'unexpected' || failure.status >= 500
          ? describeFailure(error)
          : {}),
      },
      'HTTP request failed'
    );
  }
}
