/** A safe product admission refusal with its HTTP contract. */
export class AdmissionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly decision?: Record<string, unknown>
  ) {
    super(message)
  }
}

/** Refuses malformed admission input before any product write. */
export function invalidAdmission(message = 'Invalid admission request.'): never {
  throw new AdmissionError(message, 400, 'INVALID_INPUT')
}

/** Refuses a request that lacks current company authority or proof. */
export function forbiddenAdmission(message = 'Admission is not permitted.'): never {
  throw new AdmissionError(message, 403, 'FORBIDDEN')
}

/** Prompts an existing password principal for current mailbox proof. */
export function proofRequiredAdmission(): never {
  throw new AdmissionError('Current email proof is required to join.', 401, 'EMAIL_PROOF_REQUIRED')
}

/** Conceals a missing or cross-company control record. */
export function missingAdmission(message = 'Invitation not found.'): never {
  throw new AdmissionError(message, 404, 'NOT_FOUND')
}

/** Refuses stale or already completed admission without replay. */
export function conflictingAdmission(message = 'Invitation has already been used.'): never {
  throw new AdmissionError(message, 409, 'CONFLICT')
}

/** Refuses an expired or corrupt invitation. */
export function expiredAdmission(): never {
  throw new AdmissionError('Invitation has expired.', 410, 'INVITATION_EXPIRED')
}
