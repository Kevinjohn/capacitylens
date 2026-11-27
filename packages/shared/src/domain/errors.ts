/** Every stable code a domain rule violation may carry. */
export const DOMAIN_ERROR_CODES = [
  'E_RECORD_WRONG_COMPANY',
  'E_REFERENCE_WRONG_COMPANY',
  'E_ACTIVITY_PROJECT_REQUIRED',
  'E_ACTIVITY_PROJECT_FORBIDDEN',
  'E_ACTIVITY_PHASE_FORBIDDEN',
  'E_ACTIVITY_PHASE_WRONG_COMPANY',
  'E_ACTIVITY_PHASE_PROJECT_REQUIRED',
  'E_ACTIVITY_PHASE_PROJECT_MISMATCH',
  'E_RESOURCE_PROJECT_FORBIDDEN',
  'E_RESOURCE_KIND_IMMUTABLE',
  'E_RESOURCE_AVATAR_URL_INVALID',
  'E_RESOURCE_AVATAR_URL_FORBIDDEN',
  'E_ALLOCATION_REFERENCES_INVALID',
  'E_ALLOCATION_PROJECT_FORBIDDEN',
  'E_ALLOCATION_RESOURCE_INACTIVE',
  'E_ALLOCATION_PROJECT_INACTIVE',
  'E_ALLOCATION_ACTIVITY_INACTIVE',
  'E_PLACEHOLDER_PROJECT_MISSING',
  'E_PLACEHOLDER_PROJECT_MISMATCH',
  'E_EXTERNAL_ALLOCATION_HOURS',
  'E_RESOURCE_EXTERNAL_DEPENDENTS',
  'E_PLACEHOLDER_PROJECT_DEPENDENTS',
  'E_ACTIVITY_PROJECT_DEPENDENTS',
  'E_ALLOCATION_BEFORE_RESOURCE_AVAILABILITY',
  'E_ALLOCATION_AFTER_RESOURCE_AVAILABILITY',
  'E_DATE_REQUIRED',
  'E_DATE_INVALID',
  'E_DATE_REVERSED',
  'E_DATE_SPAN_TOO_LONG',
  'E_TIME_OFF_RESOURCE_INVALID',
  'E_TIME_OFF_RESOURCE_INACTIVE',
  'E_TIME_OFF_EXTERNAL_RESOURCE',
  'E_TIME_OFF_COMPANY_WIDE_TYPE',
  'E_CLOSURE_NAME_REQUIRED',
  'E_PROJECT_CLIENT_REQUIRED',
] as const;

/** A domain rule violation code; see {@link DOMAIN_ERROR_CODES}. */
export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

/** A display-safe domain refusal with a stable identity independent from its fallback wording. */
export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DomainError';
    this.code = code;
  }
}

/** Throw a `DomainError` with a stable code and a display-safe message. */
export function throwDomainError(code: DomainErrorCode, message: string): never {
  throw new DomainError(code, message);
}
