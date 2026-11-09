import type {
  ProductHttpErrorBody,
  ProductValidationFailure,
} from '@capacitylens/shared/api/httpErrors';
import app from '@adonisjs/core/services/app';
import { type HttpContext, ExceptionHandler } from '@adonisjs/core/http';
import { errors as vineErrors } from '@vinejs/vine';
import { AdmissionRequiredError } from '@kevinjohn/adonisjs-account-kit/admission';
import { IdentityAuthorityError } from '#services/auth/authorization';
import { PasswordConfirmationError } from '#services/auth/password_confirmation';
import { AdmissionError } from '#services/admission/errors';
import { buildKitRefusal } from '#services/account_kit/refusal';
import { buildAccessRefusal } from '#services/access_control/refusal';
import { FirstCompanyPendingError } from '#models/user';
import { MasqueradeError } from '@kevinjohn/adonisjs-masquerade';
import {
  PasswordConfirmationRequiredException,
  PasswordConfirmationStaleException,
  PasswordConfirmationForbiddenException,
  PasswordConfirmationDeniedException,
  PasswordConfirmationThrottledException,
  InvalidPasswordConfirmationRequestException,
} from '@kevinjohn/adonisjs-confirm-action-with-password';
import {
  classifyLogError,
  reportPrivateFailure,
  safeRequestMethod,
  safeRoutePattern,
} from '#services/logging_safety';

type ParserFailure = 'unsupported-encoding' | 'invalid-json' | 'invalid-json-shape';

function confirmationRefusal(error: unknown) {
  if (
    error instanceof PasswordConfirmationRequiredException ||
    error instanceof PasswordConfirmationStaleException ||
    error instanceof PasswordConfirmationForbiddenException
  ) {
    return {
      status: 403,
      body: { error: 'Confirm this action again.', code: 'PASSWORD_CONFIRMATION_REQUIRED' },
    };
  }
  if (error instanceof PasswordConfirmationDeniedException) {
    return {
      status: 403,
      body: { error: 'Incorrect password.', code: 'PASSWORD_CONFIRMATION_DENIED' },
    };
  }
  if (error instanceof PasswordConfirmationThrottledException) {
    return { status: 429, body: { error: 'Rate limit exceeded.' } };
  }
  if (error instanceof InvalidPasswordConfirmationRequestException) {
    return { status: 400, body: { error: 'Invalid action confirmation.' } };
  }
}

function classifyParserFailure(error: unknown): ParserFailure | undefined {
  if (
    error instanceof Error &&
    'status' in error &&
    error.status === 415 &&
    error.message.startsWith('Unsupported Content-Encoding:')
  ) {
    return 'unsupported-encoding';
  }
  if (
    error instanceof SyntaxError &&
    'status' in error &&
    error.status === 400 &&
    'body' in error &&
    typeof error.body === 'string'
  ) {
    return 'invalid-json';
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    error.status === 422 &&
    'message' in error &&
    error.message === 'Invalid JSON, only supports object and array'
  ) {
    return 'invalid-json-shape';
  }
  return undefined;
}

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
    if (error instanceof MasqueradeError) {
      const known: Record<string, { status: number; code: string; message: string }> = {
        E_MASQUERADE_CONTEXT_REQUIRED: {
          status: 428,
          code: 'MASQUERADE_CONTEXT_REQUIRED',
          message: 'Masquerade context is required.',
        },
        E_MASQUERADE_CONTEXT_CHANGED: {
          status: 409,
          code: 'MASQUERADE_CONTEXT_CHANGED',
          message: 'Masquerade context changed.',
        },
        E_MASQUERADE_ACTION_BLOCKED: {
          status: 403,
          code: 'MASQUERADE_READ_ONLY',
          message: 'Masquerade is read-only.',
        },
        E_MASQUERADE_NOT_ALLOWED: {
          status: 403,
          code: 'AUTHORIZATION_DENIED',
          message: 'This action is not allowed.',
        },
        E_MASQUERADE_ALREADY_ACTIVE: {
          status: 409,
          code: 'MASQUERADE_ACTIVE',
          message: 'Masquerade is already active.',
        },
        E_MASQUERADE_INVALID_INPUT: {
          status: 400,
          code: 'VALIDATION_ERROR',
          message: 'Invalid masquerade request.',
        },
        E_MASQUERADE_UNAUTHENTICATED: {
          status: 401,
          code: 'SIGN_IN_REQUIRED',
          message: 'Sign-in required.',
        },
        E_MASQUERADE_UNAVAILABLE: {
          status: 503,
          code: 'MASQUERADE_UNAVAILABLE',
          message: 'Masquerade is unavailable.',
        },
      };
      const response = Object.hasOwn(known, error.code) ? known[error.code] : undefined;
      if (response) {
        return ctx.response
          .status(response.status)
          .send({ error: response.message, code: response.code });
      }
    }
    // The limited screens explain the decision, so it travels with the refusal.
    if (error instanceof AdmissionRequiredError) {
      return ctx.response.forbidden({
        error: 'Your access to this company is waiting on admission.',
        code: 'ADMISSION_REQUIRED',
        decision: error.decision,
      } satisfies ProductHttpErrorBody);
    }
    const kitRefusal = buildKitRefusal(error);
    if (kitRefusal) {
      for (const [name, value] of Object.entries(kitRefusal.headers)) {
        ctx.response.header(name, value);
      }
      return ctx.response.status(kitRefusal.status).send(kitRefusal.body);
    }
    const accessRefusal = buildAccessRefusal(error);
    if (accessRefusal) {
      ctx.response.header('Cache-Control', 'no-store');
      return ctx.response.status(accessRefusal.status).send(accessRefusal.body);
    }
    if (error instanceof AdmissionError) {
      return ctx.response.status(error.status).send({
        error: error.message,
        code: error.code,
        ...(error.decision === undefined ? {} : { decision: error.decision }),
      });
    }
    if (error instanceof PasswordConfirmationError || error instanceof FirstCompanyPendingError) {
      return ctx.response.status(error.status).send({ error: error.message, code: error.code });
    }
    const refusal = confirmationRefusal(error);
    if (refusal) return ctx.response.status(refusal.status).send(refusal.body);
    if (error instanceof IdentityAuthorityError) {
      return ctx.response.forbidden({ error: error.message, code: error.code });
    }
    if (error instanceof vineErrors.E_VALIDATION_ERROR) {
      const first = error.messages[0];
      return ctx.response.badRequest({
        error: first?.message ?? 'Invalid request.',
        code: 'VALIDATION_ERROR',
      } satisfies ProductValidationFailure['body']);
    }
    const parserFailure = classifyParserFailure(error);
    if (parserFailure === 'unsupported-encoding') {
      return ctx.response.status(415).send({
        error: 'Unsupported media type.',
        code: 'UNSUPPORTED_MEDIA_TYPE',
      } satisfies ProductHttpErrorBody);
    }
    if (parserFailure === 'invalid-json') {
      return ctx.response.badRequest({
        error: 'Request body must be valid JSON.',
        code: 'INVALID_JSON',
      } satisfies ProductHttpErrorBody);
    }
    if (parserFailure === 'invalid-json-shape') {
      return ctx.response.badRequest({
        error: 'Request JSON must be an object or array.',
        code: 'INVALID_JSON_SHAPE',
      } satisfies ProductHttpErrorBody);
    }
    if (typeof error === 'object' && error !== null) {
      const code = 'code' in error ? error.code : undefined;
      if (code === 'E_ROUTE_NOT_FOUND') {
        return ctx.response.notFound({
          error: 'Not found.',
          code: 'NOT_FOUND',
        } satisfies ProductHttpErrorBody);
      }
      if (code === 'E_REQUEST_ENTITY_TOO_LARGE') {
        return ctx.response.status(413).send({
          error: 'Request body is too large.',
          code: 'PAYLOAD_TOO_LARGE',
        } satisfies ProductHttpErrorBody);
      }
      if (code === 'E_ENCODING_UNSUPPORTED') {
        return ctx.response.status(415).send({
          error: 'Unsupported media type.',
          code: 'UNSUPPORTED_MEDIA_TYPE',
        } satisfies ProductHttpErrorBody);
      }
      if (
        code === 'SQLITE_CONSTRAINT_NOTNULL' ||
        code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
        code === 'SQLITE_CONSTRAINT_UNIQUE' ||
        code === 'SQLITE_CONSTRAINT_FOREIGNKEY' ||
        code === 'SQLITE_CONSTRAINT_CHECK'
      ) {
        return ctx.response.badRequest({
          error: 'That change references missing data or conflicts with an existing record.',
          code: 'VALIDATION_ERROR',
        } satisfies ProductValidationFailure['body']);
      }
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
    if (confirmationRefusal(error)) return;
    if (
      error instanceof IdentityAuthorityError ||
      error instanceof AdmissionError ||
      error instanceof PasswordConfirmationError ||
      error instanceof FirstCompanyPendingError
    ) {
      return;
    }
    // Mapped Access Control refusals are expected 4xx; unmapped package codes stay reportable.
    if (buildAccessRefusal(error)) return;
    // Account Kit refusals are expected outcomes; its server faults are still reported.
    const kitRefusal = buildKitRefusal(error);
    if (kitRefusal && kitRefusal.status < 500) return;
    if (
      error instanceof vineErrors.E_VALIDATION_ERROR ||
      classifyParserFailure(error) !== undefined ||
      (typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        ['E_REQUEST_ENTITY_TOO_LARGE', 'E_ENCODING_UNSUPPORTED'].includes(String(error.code)))
    ) {
      return;
    }
    const dependencyFailure = Boolean(kitRefusal);
    const errorType = kitRefusal ? 'account_kit_failure' : classifyLogError(error);
    if (!dependencyFailure && errorType !== 'unexpected' && errorType !== 'database_constraint') {
      return;
    }

    reportPrivateFailure(
      ctx,
      {
        event: 'http.request.error',
        errorType,
        method: safeRequestMethod(ctx.request.method()),
        path: safeRoutePattern(ctx.route?.pattern),
        status: errorType === 'database_constraint' ? 400 : (kitRefusal?.status ?? 500),
      },
      'HTTP request failed'
    );
  }
}
