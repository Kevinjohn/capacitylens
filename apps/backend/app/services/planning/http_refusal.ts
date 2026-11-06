import type { ProductHttpErrorBody } from '@capacitylens/shared/api/httpErrors';
import type { HttpContext } from '@adonisjs/core/http';
import { errors as vineErrors } from '@vinejs/vine';
import { accountErrorResponse } from '@kevinjohn/adonisjs-account-kit';
import { AdmissionRequiredError } from '@kevinjohn/adonisjs-account-kit/admission';
import { BatchRequestError } from '#services/planning/errors';
import { StalePlanningRevisionError } from '#services/planning_revision';
import { RestorationConfirmationError } from '#services/planning/restoration';
import { PlanningOperationError } from '#services/planning/execute';
import { IdentityAuthorityError } from '#services/auth/authorization';
import { planningMutationErrorCodes } from '#validators/planning/contracts';
import type { PlanningMutationFailure } from '#validators/planning/contracts';

/** Map a planning failure to its HTTP status and body; anything unrecognised is rethrown. */
function refusal(error: unknown): {
  status: number;
  body: PlanningMutationFailure;
  headers?: Record<string, string>;
} {
  if (error instanceof RestorationConfirmationError) {
    return {
      status: 409,
      body: {
        error: error.message,
        code: error.code,
        restorableItemCount: error.restorableItemCount,
      } satisfies ProductHttpErrorBody,
    };
  }
  if (error instanceof PlanningOperationError) {
    const code =
      planningMutationErrorCodes.find((candidate) => candidate === error.code) ??
      (error.status === 400
        ? 'VALIDATION_ERROR'
        : error.status === 403
          ? 'AUTHORIZATION_DENIED'
          : undefined);
    const status = code === 'VALIDATION_ERROR' ? 400 : error.status;
    return { status, body: { error: error.message, ...(code ? { code } : {}) } };
  }
  if (error instanceof BatchRequestError) {
    return {
      status: error.status === 403 ? 403 : 400,
      body: {
        error: error.message,
        code: error.status === 403 ? 'AUTHORIZATION_DENIED' : 'VALIDATION_ERROR',
      },
    };
  }
  if (error instanceof StalePlanningRevisionError) {
    return { status: 409, body: { error: error.message, code: 'STALE_REVISION' } };
  }
  if (error instanceof vineErrors.E_VALIDATION_ERROR) {
    return {
      status: 400,
      body: {
        error: error.messages[0]?.message ?? 'Invalid planning input.',
        code: 'VALIDATION_ERROR',
      },
    };
  }
  if (error instanceof AdmissionRequiredError) {
    return {
      status: 403,
      body: {
        error: 'Company access needs admission.',
        code: 'ADMISSION_REQUIRED',
        decision: error.decision,
      } satisfies ProductHttpErrorBody,
    };
  }
  const kitResponse = accountErrorResponse(error);
  const kitError = kitResponse?.body.errors[0];
  if (kitResponse && kitError && kitResponse.status < 500) {
    const { code, message, committed } = kitError;
    return {
      status: kitResponse.status,
      headers: kitResponse.headers,
      body: { error: message, code, ...(committed ? { committed } : {}) },
    };
  }
  // Identity resolution failures invalidate the projection; action refusals use PlanningOperationError.
  if (error instanceof IdentityAuthorityError) {
    return {
      status: 403,
      body: { error: 'Planning access is unavailable.', code: 'ACCOUNT_MEMBERSHIP_LOST' },
    };
  }
  throw error;
}

/** Send a planning refusal with its HTTP status, flat error body and any Kit headers. */
export function sendRefusal(error: unknown, ctx: HttpContext) {
  const failure = refusal(error);
  for (const [name, value] of Object.entries(failure.headers ?? {})) {
    ctx.response.header(name, value);
  }
  return ctx.response.status(failure.status).send(failure.body);
}
