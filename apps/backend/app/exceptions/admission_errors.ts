import ValidationRefusalException from '#exceptions/validation_refusal_exception';
import ConflictException from '#exceptions/conflict_exception';
import NotFoundException from '#exceptions/not_found_exception';

/** Refuses a malformed admission id before any product write. */
export function refuseInvalidAdmission(): never {
  throw new ValidationRefusalException('Invalid admission request.');
}

/** Conceals a missing or cross-company control record. */
export function refuseMissingAdmission(message = 'Invitation not found.'): never {
  throw new NotFoundException(message);
}

/** Refuses stale or already completed admission without replay. */
export function refuseConflictingAdmission(message = 'Invitation has already been used.'): never {
  throw new ConflictException(message);
}
