import { errors as vineErrors } from '@vinejs/vine';
import { AdmissionException } from '#exceptions/admission_exception';

/** Refuses malformed admission input before any product write. */
export function refuseInvalidAdmission(message = 'Invalid admission request.'): never {
  throw new AdmissionException(message, 400, 'VALIDATION_ERROR');
}

/**
 * Turns a refused request body into the admission refusal, with the sentence the validator
 * reports first. Call with the error `tryValidateUsing` returns; any other value is re-thrown.
 */
export function refuseInvalidAdmissionBody(error: unknown): never {
  if (error instanceof vineErrors.E_VALIDATION_ERROR) {
    refuseInvalidAdmission(error.messages[0]?.message);
  }
  throw error;
}

/** Conceals a missing or cross-company control record. */
export function refuseMissingAdmission(message = 'Invitation not found.'): never {
  throw new AdmissionException(message, 404, 'NOT_FOUND');
}

/** Refuses stale or already completed admission without replay. */
export function refuseConflictingAdmission(message = 'Invitation has already been used.'): never {
  throw new AdmissionException(message, 409, 'CONFLICT');
}
