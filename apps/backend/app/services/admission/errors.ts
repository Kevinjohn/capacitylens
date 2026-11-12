import { RefusalError } from '#exceptions/refusal_error';

/** A safe product admission refusal with its HTTP contract. */
export class AdmissionError extends RefusalError {
  constructor(
    message: string,
    status: number,
    code: string,
    readonly decision?: Record<string, unknown>
  ) {
    super(message, status, code);
  }

  override body() {
    return { ...super.body(), ...(this.decision === undefined ? {} : { decision: this.decision }) };
  }
}

/** Refuses malformed admission input before any product write. */
export function invalidAdmission(message = 'Invalid admission request.'): never {
  throw new AdmissionError(message, 400, 'INVALID_INPUT');
}

/** Conceals a missing or cross-company control record. */
export function missingAdmission(message = 'Invitation not found.'): never {
  throw new AdmissionError(message, 404, 'NOT_FOUND');
}

/** Refuses stale or already completed admission without replay. */
export function conflictingAdmission(message = 'Invitation has already been used.'): never {
  throw new AdmissionError(message, 409, 'CONFLICT');
}
