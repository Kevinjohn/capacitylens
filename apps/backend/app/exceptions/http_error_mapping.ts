// Validation and domain errors use the flat `{ error, code? }` contract. Vine runs behind the
// product's response adapters, so a validation failure answers 400 rather than Vine's 422
// `errors[]`; the SPA keys its presentation on `code`.

import type {
  ProductHttpErrorBody,
  ProductValidationFailure,
} from '@capacitylens/shared/api/httpErrors';
import { errors as httpServerErrors } from '@adonisjs/core/http';
import { errors as vineErrors } from '@vinejs/vine';
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
import { IdentityAuthorizationException } from '#exceptions/identity_authorization_exception';
import { RefusalException } from '#exceptions/refusal_exception';
import { buildKitRefusal } from '#services/account_kit/refusal';
import { buildAccessRefusal } from '#services/access_control/refusal';
import { StalePlanningRevisionException } from '#exceptions/stale_planning_revision_exception';
import { EntityWriteException } from '#exceptions/entity_write_exception';
import { PlanningOperationException } from '#exceptions/planning_operation_exception';
import { RestorationConfirmationException } from '#exceptions/restoration_confirmation_exception';

/** One mapped HTTP outcome. `report` marks a mapped outcome that is still logged as a failure. */
export interface HttpErrorResponse {
  status: number;
  body: object;
  headers?: Record<string, string>;
  report?: { errorType: string; status: number };
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

function buildMasqueradeResponse(error: MasqueradeError): HttpErrorResponse | undefined {
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

const CONSTRAINT_CODES = new Set([
  'SQLITE_CONSTRAINT_NOTNULL',
  'SQLITE_CONSTRAINT_PRIMARYKEY',
  'SQLITE_CONSTRAINT_UNIQUE',
  'SQLITE_CONSTRAINT_FOREIGNKEY',
  'SQLITE_CONSTRAINT_CHECK',
]);

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
  // A constraint failure is answered as invalid input but still logged: it means a check upstream
  // let a bad write through.
  if (typeof code === 'string' && CONSTRAINT_CODES.has(code)) {
    return {
      status: 400,
      body: {
        error: 'That change references missing data or conflicts with an existing record.',
        code: 'VALIDATION_ERROR',
      } satisfies ProductValidationFailure['body'],
      report: { errorType: 'database_constraint', status: 400 },
    };
  }
}

/** Planning service refusals: the restoration count, the stated status and code, stale revisions. */
function buildPlanningResponse(error: unknown): HttpErrorResponse | undefined {
  if (error instanceof RestorationConfirmationException) {
    return {
      status: 409,
      body: {
        error: error.message,
        code: error.code,
        restorableItemCount: error.restorableItemCount,
      } satisfies ProductHttpErrorBody,
    };
  }
  if (error instanceof PlanningOperationException) {
    return {
      status: error.status,
      body: { error: error.message, ...(error.code ? { code: error.code } : {}) },
    };
  }
  // The planning executor already turns an entity refusal into authorization or validation; the
  // import and example-data services send the stated status, code and the current revision.
  if (error instanceof EntityWriteException) {
    return {
      status: error.status,
      body: {
        error: error.message,
        ...(error.code ? { code: error.code } : {}),
        ...(error.current ?? {}),
      },
    };
  }
  if (error instanceof StalePlanningRevisionException) {
    return { status: 409, body: { error: error.message, code: 'STALE_REVISION' } };
  }
}

/**
 * The central handler's mapping from each known error class to its HTTP outcome, in precedence
 * order. Anything it returns with a status below 500 and no `report` is an expected refusal and is
 * not logged; anything it does not recognise is an unexpected failure.
 */
export function mapHttpError(error: unknown): HttpErrorResponse | undefined {
  const planning = buildPlanningResponse(error);
  if (planning) return planning;
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
      ...(kitRefusal.status >= 500
        ? { report: { errorType: 'account_kit_failure', status: kitRefusal.status } }
        : {}),
    };
  }
  const accessRefusal = buildAccessRefusal(error);
  if (accessRefusal) {
    return { ...accessRefusal, headers: { 'Cache-Control': 'no-store' } };
  }
  if (error instanceof RefusalException) return { status: error.status, body: error.body() };
  const confirmation = buildConfirmationResponse(error);
  if (confirmation) return confirmation;
  if (error instanceof IdentityAuthorizationException) {
    return { status: 403, body: { error: error.message, code: error.code } };
  }
  if (error instanceof vineErrors.E_VALIDATION_ERROR) {
    return {
      status: 400,
      body: {
        error: error.messages[0]?.message ?? 'Invalid request.',
        code: 'VALIDATION_ERROR',
      } satisfies ProductValidationFailure['body'],
    };
  }
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
