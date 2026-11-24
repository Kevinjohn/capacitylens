import { AdmissionException } from '#exceptions/admission_exception';
import { ValidationRefusalException } from '#exceptions/validation_refusal_exception';

/** Refuses a malformed admission id before any product write. */
export function refuseInvalidAdmission(): never {
  throw new ValidationRefusalException('Invalid admission request.');
}

/** Conceals a missing or cross-company control record. */
export function refuseMissingAdmission(message = 'Invitation not found.'): never {
  throw new AdmissionException(message, 404, 'NOT_FOUND');
}

/** Refuses stale or already completed admission without replay. */
export function refuseConflictingAdmission(message = 'Invitation has already been used.'): never {
  throw new AdmissionException(message, 409, 'CONFLICT');
}
