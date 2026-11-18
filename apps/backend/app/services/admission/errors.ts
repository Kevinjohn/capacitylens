import { AdmissionError } from '#exceptions/admission_error';

/** Refuses malformed admission input before any product write. */
export function refuseInvalidAdmission(message = 'Invalid admission request.'): never {
  throw new AdmissionError(message, 400, 'VALIDATION_ERROR');
}

/** Conceals a missing or cross-company control record. */
export function refuseMissingAdmission(message = 'Invitation not found.'): never {
  throw new AdmissionError(message, 404, 'NOT_FOUND');
}

/** Refuses stale or already completed admission without replay. */
export function refuseConflictingAdmission(message = 'Invitation has already been used.'): never {
  throw new AdmissionError(message, 409, 'CONFLICT');
}
