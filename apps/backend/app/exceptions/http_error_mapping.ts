// Package and parser errors are not ours to describe, so the exception handler answers
// them here in the product's flat `{ error, code? }` body before it calls `super.handle`; invalid
// input takes the framework's 422 `{ errors }` body. Product exceptions answer for themselves, and
// a Vine validation failure takes the framework's answer.

import type { ProductHttpErrorBody } from '@capacitylens/shared/api/httpErrors';
import { errors as httpServerErrors } from '@adonisjs/core/http';
import { errors as limiterErrors } from '@adonisjs/limiter';
import { CompanyExportError } from '@capacitylens/shared/data/companyExport';
import { AdmissionRequiredError } from '@kevinjohn/adonisjs-account-kit/admission';
import { MasqueradeError } from '@kevinjohn/adonisjs-masquerade';
import {
  PasswordConfirmationRequiredException,
  PasswordConfirmationStaleException,
  PasswordConfirmationForbiddenException,
  PasswordConfirmationDeniedException,
  PasswordConfirmationThrottledException,
  InvalidPasswordConfirmationRequestException,
} from '@kevinjohn/adonisjs-confirm-action-with-password';
import { buildKitRefusal } from '#services/account_kit/refusal';
import { buildAccessRefusal } from '#services/access_control/refusal';
import { buildValidationBody } from '#exceptions/validation_refusal_exception';

/**
 * One answered package error. `errorType` marks an answer whose error is still logged as a server
 * fault, under that category.
 */
export interface HttpErrorResponse {
  status: number;
  body: object;
  headers?: Record<string, string>;
  errorType?: string;
}

/**
 * Admission refusals carry the decision so the limited screens can explain it. Planning access
 * refusals (`ACCOUNT_MEMBERSHIP_LOST`, which tells the browser to drop its planning projection)
 * are produced in `company_scope_middleware.ts` and the planning access check, not here.
 */
function buildAdmissionRequiredResponse(error: AdmissionRequiredError): HttpErrorResponse {
  return {
    status: 403,
    body: {
      error: 'Your access to this company is waiting on admission.',
      code: 'ADMISSION_REQUIRED',
      decision: error.decision,
    } satisfies ProductHttpErrorBody,
  };
}

const MASQUERADE_RESPONSES: Record<string, { status: number; code: string; message: string }> = {
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

function buildMasqueradeResponse(error: MasqueradeError): HttpErrorResponse | undefined {
  // Invalid input answers like any other validation refusal.
  if (error.code === 'E_MASQUERADE_INVALID_INPUT') {
    return { status: 422, body: buildValidationBody('Invalid masquerade request.') };
  }
  const known = Object.hasOwn(MASQUERADE_RESPONSES, error.code)
    ? MASQUERADE_RESPONSES[error.code]
    : undefined;
  return known && { status: known.status, body: { error: known.message, code: known.code } };
}

function buildConfirmationResponse(error: unknown): HttpErrorResponse | undefined {
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
    const seconds = Math.max(1, Math.ceil(error.retryAfterSeconds));
    const minutes = Math.ceil(seconds / 60);
    return {
      status: 429,
      headers: { 'Retry-After': String(seconds) },
      body: {
        error: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      },
    };
  }
  if (error instanceof InvalidPasswordConfirmationRequestException) {
    return { status: 400, body: { error: 'Invalid password confirmation.' } };
  }
}

function buildParserFailureResponse(error: unknown): HttpErrorResponse | undefined {
  if (
    error instanceof Error &&
    'status' in error &&
    error.status === 415 &&
    error.message.startsWith('Unsupported Content-Encoding:')
  ) {
    return {
      status: 415,
      body: {
        error: 'Unsupported media type.',
        code: 'UNSUPPORTED_MEDIA_TYPE',
      } satisfies ProductHttpErrorBody,
    };
  }
  if (
    error instanceof SyntaxError &&
    'status' in error &&
    error.status === 400 &&
    'body' in error &&
    typeof error.body === 'string'
  ) {
    return {
      status: 400,
      body: {
        error: 'Request body must be valid JSON.',
        code: 'INVALID_JSON',
      } satisfies ProductHttpErrorBody,
    };
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    error.status === 422 &&
    'message' in error &&
    error.message === 'Invalid JSON, only supports object and array'
  ) {
    return {
      status: 400,
      body: {
        error: 'Request JSON must be an object or array.',
        code: 'INVALID_JSON_SHAPE',
      } satisfies ProductHttpErrorBody,
    };
  }
}

function buildFrameworkCodeResponse(error: unknown): HttpErrorResponse | undefined {
  if (typeof error !== 'object' || error === null) return;
  const code = 'code' in error ? error.code : undefined;
  if (error instanceof httpServerErrors.E_ROUTE_NOT_FOUND) {
    return {
      status: 404,
      body: { error: 'Not found.', code: 'NOT_FOUND' } satisfies ProductHttpErrorBody,
    };
  }
  if (code === 'E_REQUEST_ENTITY_TOO_LARGE') {
    return {
      status: 413,
      body: {
        error: 'Request body is too large.',
        code: 'PAYLOAD_TOO_LARGE',
      } satisfies ProductHttpErrorBody,
    };
  }
  if (code === 'E_ENCODING_UNSUPPORTED') {
    return {
      status: 415,
      body: {
        error: 'Unsupported media type.',
        code: 'UNSUPPORTED_MEDIA_TYPE',
      } satisfies ProductHttpErrorBody,
    };
  }
}

/**
 * The answer to each package or parser error the product recognises, in precedence
 * order; `undefined` for anything else. Several of these errors have their own `handle`, which would
 * send the package's envelope, so the handler must answer them before `super.handle`.
 */
export function mapPackageError(error: unknown): HttpErrorResponse | undefined {
  if (error instanceof MasqueradeError) {
    const masquerade = buildMasqueradeResponse(error);
    if (masquerade) return masquerade;
  }
  if (error instanceof AdmissionRequiredError) {
    return buildAdmissionRequiredResponse(error);
  }
  const kitRefusal = buildKitRefusal(error);
  if (kitRefusal) {
    return {
      ...kitRefusal,
      // Account Kit refusals are expected outcomes; its server faults are still reported.
      ...(kitRefusal.status >= 500 ? { errorType: 'account_kit_failure' } : {}),
    };
  }
  const accessRefusal = buildAccessRefusal(error);
  if (accessRefusal) {
    return { ...accessRefusal, headers: { 'Cache-Control': 'no-store' } };
  }
  const confirmation = buildConfirmationResponse(error);
  if (confirmation) return confirmation;
  // Shared code holds no backend code (departure 1), so the export format's own error is answered here.
  if (error instanceof CompanyExportError) {
    return { status: 400, body: { error: error.message } };
  }
  if (error instanceof limiterErrors.E_TOO_MANY_REQUESTS) {
    const headers = Object.fromEntries(
      Object.entries(error.getDefaultHeaders()).map(([name, value]) => [name, String(value)])
    );
    return { status: 429, headers, body: { error: 'Rate limit exceeded.' } };
  }
  return buildParserFailureResponse(error) ?? buildFrameworkCodeResponse(error);
}
