import type { ProductHttpErrorBody } from '@capacitylens/shared/api/httpErrors';
import type { HttpContext } from '@adonisjs/core/http';
import { errors as vineErrors } from '@vinejs/vine';
import { AdmissionRequiredError } from '@kevinjohn/adonisjs-account-kit/admission';
import { buildKitRefusal } from '#services/account_kit/refusal';
import { buildAccessRefusal } from '#services/access_control/refusal';
import { EntityWriteError } from '#services/planning/errors';
import { StalePlanningRevisionError } from '#services/planning_revision';
import { RestorationConfirmationError } from '#services/planning/restoration';
import { PlanningOperationError } from '#services/planning/execute';
import { IdentityAuthorityError } from '#services/auth/authorization';
import type { PlanningMutationFailure } from '#validators/planning/contracts';
import {
  buildAdmissionRequiredResponse,
  identityAuthorityResponse,
} from '#exceptions/http_error_mapping';

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
    return {
      status: error.status,
      body: { error: error.message, ...(error.code ? { code: error.code } : {}) },
    };
  }
  if (error instanceof EntityWriteError) {
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
    return buildAdmissionRequiredResponse(error, 'planning');
  }
  const kitRefusal = buildKitRefusal(error);
  if (kitRefusal && kitRefusal.status < 500) return kitRefusal;
  const accessRefusal = buildAccessRefusal(error);
  if (accessRefusal) return accessRefusal;
  if (error instanceof IdentityAuthorityError) {
    return identityAuthorityResponse(error, 'planning');
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
