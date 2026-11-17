import { AdmissionError } from '#exceptions/admission_error';

/** Refuses malformed admission input before any product write. */
export function invalidAdmission(message = 'Invalid admission request.'): never {
  throw new AdmissionError(message, 400, 'VALIDATION_ERROR');
}

/** Conceals a missing or cross-company control record. */
export function missingAdmission(message = 'Invitation not found.'): never {
  throw new AdmissionError(message, 404, 'NOT_FOUND');
}

/** Refuses stale or already completed admission without replay. */
export function conflictingAdmission(message = 'Invitation has already been used.'): never {
  throw new AdmissionError(message, 409, 'CONFLICT');
}
