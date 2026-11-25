import { ConflictException, NotFoundException } from '#exceptions/refusal_exception';

/** Conceals a missing or cross-company control record. */
export function refuseMissingAdmission(message = 'Invitation not found.'): never {
  throw new NotFoundException(message);
}

/** Refuses stale or already completed admission without replay. */
export function refuseConflictingAdmission(message = 'Invitation has already been used.'): never {
  throw new ConflictException(message);
}
